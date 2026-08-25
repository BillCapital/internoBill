-- 3 llaves para compras tecnológicas: gerente de área (del depto solicitante) + TI (Sistema) + RRHH (Juan)
-- El conjunto se des-duplica por persona: si el gerente de área ya es Sistema o Juan, cuenta una vez.
-- Gerencia (sin gerente de área) queda con las 2 llaves de tecnología (su 1ª llave la cubre la gestora).

-- Gerente de área del departamento de la solicitud (el nombre guardado ya es el depto raíz)
create or replace function public.req_area_manager(p_id uuid)
returns uuid language sql stable security definer set search_path to 'public' as $$
  select d.manager_id
  from public.requests r
  join public.departments d on d.name = r.department
  where r.id = p_id;
$$;

-- Conjunto de firmantes requeridos (2ª fase): aprobadores de tecnología + gerente de área (si existe y está activo), sin repetir
create or replace function public.req_required_approvers(p_id uuid)
returns setof uuid language sql stable security definer set search_path to 'public' as $$
  select id from public.profiles where is_tech_approver and coalesce(active,true)
  union
  select p.id from public.profiles p
    where p.id = public.req_area_manager(p_id) and coalesce(p.active,true);
$$;

grant execute on function public.req_area_manager(uuid) to authenticated;
grant execute on function public.req_required_approvers(uuid) to authenticated;

-- El gerente de área puede ver quién firmó (request_approvals)
drop policy if exists request_approvals_select on public.request_approvals;
create policy request_approvals_select on public.request_approvals for select
  using (
    public.can_manage_orders() or public.is_tech_approver()
    or auth.uid() = public.req_area_manager(request_id)
    or exists (select 1 from public.requests r where r.id = request_id and r.user_id = auth.uid())
  );

-- 1ª llave (gestora): manda a manager_review si hay firmantes requeridos, y les avisa a todos
create or replace function public.approve_request(p_id uuid)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare falta text; owner uuid; who text; nm boolean; v_dept text; v_napprovers int;
begin
  if not public.can_manage_orders() then raise exception 'No autorizado'; end if;
  select needs_manager, department, user_id into nm, v_dept, owner from public.requests where id=p_id and status='pending';
  if not found then raise exception 'Solicitud no encontrada o ya resuelta'; end if;
  select ii.name into falta from public.request_items ri join public.inventory_items ii on ii.id=ri.item_id where ri.request_id=p_id and ii.stock < ri.quantity limit 1;
  if falta is not null then raise exception 'No hay stock suficiente de "%"', falta; end if;
  select coalesce(full_name,email) into who from public.profiles where id=owner;
  select count(*) into v_napprovers from public.req_required_approvers(p_id);

  if nm and v_napprovers > 0 then
    update public.requests set status='manager_review', l1_by=auth.uid(), l1_at=now() where id=p_id and status='pending';
    insert into public.messages(thread_type,thread_id,sender_id,body,is_system)
      values('request',p_id,auth.uid(),'Aprobada por gestión. Compra tecnológica: requiere la autorización del gerente de área y de los aprobadores de tecnología.',true);
    perform public.notify(owner,'Solicitud en revisión','Tu solicitud pasó el visto bueno de gestión; espera las autorizaciones (gerente de área y tecnología).','/solicitudes','info');
    insert into public.notifications(user_id,title,body,link,kind)
      select ra, 'Compra por autorizar', coalesce(who,'—')||' · '||coalesce(nullif(v_dept,''),'—'), '/solicitudes','info'
      from public.req_required_approvers(p_id) ra;
    perform public.log_activity('Solicitud','En revisión de autorizaciones', 'Solicitante: '||coalesce(who,'—')||' · '||coalesce(nullif(v_dept,''),'—'));
  else
    update public.requests set status='approved', l1_by=auth.uid(), l1_at=now() where id=p_id and status='pending';
    update public.inventory_items ii set stock=greatest(0, ii.stock - ri.quantity) from public.request_items ri where ri.item_id=ii.id and ri.request_id=p_id;
    insert into public.messages(thread_type,thread_id,sender_id,body,is_system) values('request',p_id,auth.uid(),'Solicitud aprobada. Stock descontado.',true);
    perform public.notify(owner,'Solicitud aprobada','Tu solicitud fue aprobada y el stock descontado.','/solicitudes','ok');
    perform public.log_activity('Solicitud','Aprobada', 'Solicitante: '||coalesce(who,'—'));
  end if;
end; $function$;

-- Firma (2ª/3ª llave): la puede dar un aprobador de tecnología O el gerente de área del depto. Cuando todos firman -> aprobado + stock
create or replace function public.tech_approve_request(p_id uuid)
 returns text language plpgsql security definer set search_path to 'public'
as $function$
declare v_dept text; falta text; owner uuid; who text; req_count int; got_count int;
begin
  if not (public.is_tech_approver() or auth.uid() = public.req_area_manager(p_id)) then
    raise exception 'No autorizado: no eres firmante de esta compra';
  end if;
  select department, user_id into v_dept, owner from public.requests where id=p_id and status='manager_review';
  if not found then raise exception 'La solicitud no está esperando autorización'; end if;

  insert into public.request_approvals(request_id, approver_id, decision)
    values(p_id, auth.uid(), 'approve')
    on conflict (request_id, approver_id) do update set decision='approve', at=now();

  select count(*) into req_count from public.req_required_approvers(p_id);
  select count(distinct ra.approver_id) into got_count
    from public.request_approvals ra
    where ra.request_id=p_id and ra.decision='approve'
      and ra.approver_id in (select public.req_required_approvers(p_id));

  select coalesce(full_name,email) into who from public.profiles where id=owner;
  insert into public.messages(thread_type,thread_id,sender_id,body,is_system)
    values('request',p_id,auth.uid(), (select coalesce(full_name,email) from public.profiles where id=auth.uid())||' autorizó la compra ('||got_count||'/'||req_count||').', true);

  if got_count >= req_count then
    select ii.name into falta from public.request_items ri join public.inventory_items ii on ii.id=ri.item_id where ri.request_id=p_id and ii.stock < ri.quantity limit 1;
    if falta is not null then raise exception 'No hay stock suficiente de "%"', falta; end if;
    update public.requests set status='approved', mgr_by=auth.uid(), mgr_at=now() where id=p_id and status='manager_review';
    update public.inventory_items ii set stock=greatest(0, ii.stock - ri.quantity) from public.request_items ri where ri.item_id=ii.id and ri.request_id=p_id;
    insert into public.messages(thread_type,thread_id,sender_id,body,is_system) values('request',p_id,auth.uid(),'Compra autorizada por todos los firmantes. Stock descontado.',true);
    perform public.notify(owner,'Compra autorizada','Tu compra fue autorizada por todos los firmantes.','/solicitudes','ok');
    perform public.notify_perm('manage_orders','Compra autorizada', coalesce(who,'—')||' · '||coalesce(nullif(v_dept,''),'—'),'/solicitudes', null);
    perform public.log_activity('Solicitud','Compra autorizada (todas las llaves)', 'Solicitante: '||coalesce(who,'—'));
    return 'approved';
  else
    perform public.notify(owner,'Autorización parcial','Un firmante autorizó tu compra ('||got_count||'/'||req_count||'). Falta el resto.','/solicitudes','info');
    return 'manager_review';
  end if;
end; $function$;

-- Rechazo: lo puede dar un aprobador de tecnología O el gerente de área
create or replace function public.tech_reject_request(p_id uuid, p_reason text default ''::text)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare owner uuid; who text;
begin
  if not (public.is_tech_approver() or auth.uid() = public.req_area_manager(p_id)) then
    raise exception 'No autorizado: no eres firmante de esta compra';
  end if;
  select user_id into owner from public.requests where id=p_id and status='manager_review';
  if not found then raise exception 'La solicitud no está esperando autorización'; end if;
  insert into public.request_approvals(request_id, approver_id, decision)
    values(p_id, auth.uid(), 'reject') on conflict (request_id, approver_id) do update set decision='reject', at=now();
  update public.requests set status='rejected', admin_note=coalesce(p_reason,'') where id=p_id and status='manager_review';
  insert into public.messages(thread_type,thread_id,sender_id,body) values('request',p_id,auth.uid(),'Compra rechazada por un firmante: '||coalesce(nullif(trim(p_reason),''),'sin motivo'));
  select coalesce(full_name,email) into who from public.profiles where id=owner;
  perform public.notify(owner,'Compra rechazada', coalesce(nullif(trim(p_reason),''),'Sin motivo'),'/solicitudes','bad');
  perform public.log_activity('Solicitud','Compra rechazada', 'Solicitante: '||coalesce(who,'—'));
end; $function$;
