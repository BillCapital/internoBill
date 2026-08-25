-- Insumos tecnológicos: gestora -> AMBOS aprobadores de tecnología (Gerente TI + Juan)

-- 1) Marcar aprobadores de tecnología
alter table public.profiles add column if not exists is_tech_approver boolean not null default false;
update public.profiles set is_tech_approver = true
 where id in ('d0a69580-7c5d-4523-b82a-7fd50f32de55','9f530e3f-7aa8-4b38-8f97-066d00c719d5');

-- 2) Helper primero (lo usan las políticas)
create or replace function public.is_tech_approver()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_tech_approver and coalesce(p.active,true));
$$;
grant execute on function public.is_tech_approver() to authenticated;

-- 3) Registro de firmas
create table if not exists public.request_approvals (
  request_id uuid not null references public.requests(id) on delete cascade,
  approver_id uuid not null references public.profiles(id) on delete cascade,
  decision text not null default 'approve',
  at timestamptz not null default now(),
  primary key (request_id, approver_id)
);
alter table public.request_approvals enable row level security;
drop policy if exists request_approvals_select on public.request_approvals;
create policy request_approvals_select on public.request_approvals for select
  using (public.can_manage_orders() or public.is_tech_approver()
    or exists(select 1 from public.requests r where r.id=request_id and r.user_id=auth.uid()));

-- 4) Visibilidad para aprobadores de tecnología
drop policy if exists requests_select_own_or_admin on public.requests;
create policy requests_select_own_or_admin on public.requests for select
  using ((user_id = auth.uid()) or public.can_manage_orders() or public.manages_dept(department)
    or (public.is_tech_approver() and needs_manager));

drop policy if exists request_items_select on public.request_items;
create policy request_items_select on public.request_items for select
  using (exists (select 1 from public.requests r where r.id = request_items.request_id
    and (r.user_id = auth.uid() or public.can_manage_orders() or public.manages_dept(r.department)
      or (public.is_tech_approver() and r.needs_manager))));

create or replace function public.can_access_thread(p_type text, p_id uuid)
returns boolean language plpgsql stable security definer set search_path to 'public' as $function$
declare owner uuid; dep text; nm boolean;
begin
  if p_type='request' then
    select user_id, department, needs_manager into owner, dep, nm from public.requests where id=p_id;
    return owner=auth.uid() or public.can_manage_orders() or public.manages_dept(dep) or (public.is_tech_approver() and nm);
  elsif p_type='reservation' then
    select user_id into owner from public.reservations where id=p_id;
    return owner=auth.uid() or public.can_manage_rooms();
  elsif p_type='ticket' then
    select user_id into owner from public.support_tickets where id=p_id;
    return owner=auth.uid() or public.is_admin();
  end if;
  return false;
end; $function$;

-- 5) 1ª llave (gestora)
create or replace function public.approve_request(p_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare falta text; owner uuid; who text; nm boolean; v_dept text; v_napprovers int;
begin
  if not public.can_manage_orders() then raise exception 'No autorizado'; end if;
  select needs_manager, department, user_id into nm, v_dept, owner from public.requests where id=p_id and status='pending';
  if not found then raise exception 'Solicitud no encontrada o ya resuelta'; end if;
  select ii.name into falta from public.request_items ri join public.inventory_items ii on ii.id=ri.item_id where ri.request_id=p_id and ii.stock < ri.quantity limit 1;
  if falta is not null then raise exception 'No hay stock suficiente de "%"', falta; end if;
  select coalesce(full_name,email) into who from public.profiles where id=owner;
  select count(*) into v_napprovers from public.profiles where is_tech_approver and coalesce(active,true);

  if nm and v_napprovers > 0 then
    update public.requests set status='manager_review', l1_by=auth.uid(), l1_at=now() where id=p_id and status='pending';
    insert into public.messages(thread_type,thread_id,sender_id,body,is_system)
      values('request',p_id,auth.uid(),'Aprobada por gestión. Compra tecnológica: requiere autorización de TODOS los gerentes de tecnología.',true);
    perform public.notify(owner,'Solicitud en revisión','Tu solicitud pasó el visto bueno de gestión; espera la autorización de los gerentes de tecnología.','/solicitudes','info');
    insert into public.notifications(user_id,title,body,link,kind)
      select id, 'Compra tecnológica por autorizar', coalesce(who,'—')||' · '||coalesce(nullif(v_dept,''),'—'), '/solicitudes','info'
      from public.profiles where is_tech_approver and coalesce(active,true);
    perform public.log_activity('Solicitud','En revisión de tecnología', 'Solicitante: '||coalesce(who,'—')||' · '||coalesce(nullif(v_dept,''),'—'));
  else
    update public.requests set status='approved', l1_by=auth.uid(), l1_at=now() where id=p_id and status='pending';
    update public.inventory_items ii set stock=greatest(0, ii.stock - ri.quantity) from public.request_items ri where ri.item_id=ii.id and ri.request_id=p_id;
    insert into public.messages(thread_type,thread_id,sender_id,body,is_system) values('request',p_id,auth.uid(),'Solicitud aprobada. Stock descontado.',true);
    perform public.notify(owner,'Solicitud aprobada','Tu solicitud fue aprobada y el stock descontado.','/solicitudes','ok');
    perform public.log_activity('Solicitud','Aprobada', 'Solicitante: '||coalesce(who,'—'));
  end if;
end; $function$;

-- 6) Firma de tecnología: cuando TODOS firman -> aprobado + stock
create or replace function public.tech_approve_request(p_id uuid)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_dept text; falta text; owner uuid; who text; req_count int; got_count int;
begin
  if not public.is_tech_approver() then raise exception 'No autorizado: no eres gerente de tecnología'; end if;
  select department, user_id into v_dept, owner from public.requests where id=p_id and status='manager_review';
  if not found then raise exception 'La solicitud no está esperando autorización de tecnología'; end if;

  insert into public.request_approvals(request_id, approver_id, decision)
    values(p_id, auth.uid(), 'approve')
    on conflict (request_id, approver_id) do update set decision='approve', at=now();

  select count(*) into req_count from public.profiles where is_tech_approver and coalesce(active,true);
  select count(distinct ra.approver_id) into got_count
    from public.request_approvals ra join public.profiles pa on pa.id=ra.approver_id
    where ra.request_id=p_id and ra.decision='approve' and pa.is_tech_approver and coalesce(pa.active,true);

  select coalesce(full_name,email) into who from public.profiles where id=owner;
  insert into public.messages(thread_type,thread_id,sender_id,body,is_system)
    values('request',p_id,auth.uid(), (select coalesce(full_name,email) from public.profiles where id=auth.uid())||' autorizó la compra tecnológica ('||got_count||'/'||req_count||').', true);

  if got_count >= req_count then
    select ii.name into falta from public.request_items ri join public.inventory_items ii on ii.id=ri.item_id where ri.request_id=p_id and ii.stock < ri.quantity limit 1;
    if falta is not null then raise exception 'No hay stock suficiente de "%"', falta; end if;
    update public.requests set status='approved', mgr_by=auth.uid(), mgr_at=now() where id=p_id and status='manager_review';
    update public.inventory_items ii set stock=greatest(0, ii.stock - ri.quantity) from public.request_items ri where ri.item_id=ii.id and ri.request_id=p_id;
    insert into public.messages(thread_type,thread_id,sender_id,body,is_system) values('request',p_id,auth.uid(),'Compra tecnológica autorizada por todos los gerentes. Stock descontado.',true);
    perform public.notify(owner,'Compra autorizada','Tu compra tecnológica fue autorizada por todos los gerentes.','/solicitudes','ok');
    perform public.notify_perm('manage_orders','Compra tecnológica autorizada', coalesce(who,'—')||' · '||coalesce(nullif(v_dept,''),'—'),'/solicitudes', null);
    perform public.log_activity('Solicitud','Compra tecnológica autorizada', 'Solicitante: '||coalesce(who,'—'));
    return 'approved';
  else
    perform public.notify(owner,'Autorización parcial','Un gerente de tecnología autorizó tu compra ('||got_count||'/'||req_count||'). Falta el resto.','/solicitudes','info');
    return 'manager_review';
  end if;
end; $function$;

create or replace function public.tech_reject_request(p_id uuid, p_reason text DEFAULT ''::text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare owner uuid; who text;
begin
  if not public.is_tech_approver() then raise exception 'No autorizado: no eres gerente de tecnología'; end if;
  select user_id into owner from public.requests where id=p_id and status='manager_review';
  if not found then raise exception 'La solicitud no está esperando autorización de tecnología'; end if;
  insert into public.request_approvals(request_id, approver_id, decision)
    values(p_id, auth.uid(), 'reject') on conflict (request_id, approver_id) do update set decision='reject', at=now();
  update public.requests set status='rejected', admin_note=coalesce(p_reason,'') where id=p_id and status='manager_review';
  insert into public.messages(thread_type,thread_id,sender_id,body) values('request',p_id,auth.uid(),'Compra tecnológica rechazada por un gerente de tecnología: '||coalesce(nullif(trim(p_reason),''),'sin motivo'));
  select coalesce(full_name,email) into who from public.profiles where id=owner;
  perform public.notify(owner,'Compra rechazada', coalesce(nullif(trim(p_reason),''),'Sin motivo'),'/solicitudes','bad');
  perform public.log_activity('Solicitud','Compra tecnológica rechazada', 'Solicitante: '||coalesce(who,'—'));
end; $function$;

grant execute on function public.tech_approve_request(uuid) to authenticated;
grant execute on function public.tech_reject_request(uuid, text) to authenticated;
