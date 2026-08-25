-- ============================================================
-- Doble aprobación (2 llaves) para insumos tecnológicos/periféricos
--   Solicitud -> gestora/admin (1er V°B°) -> gerente de área (2do V°B°) -> Pedido
-- ============================================================

-- 1) Columnas nuevas
alter table public.inventory_items add column if not exists requires_manager boolean not null default false;
alter table public.departments add column if not exists manager_id uuid references public.profiles(id) on delete set null;
alter table public.requests
  add column if not exists needs_manager boolean not null default false,
  add column if not exists l1_by uuid,
  add column if not exists l1_at timestamptz,
  add column if not exists mgr_by uuid,
  add column if not exists mgr_at timestamptz;

-- Pre-marcar insumos tecnológicos / periféricos existentes (ajustable luego en Insumos)
update public.inventory_items set requires_manager = true
 where requires_manager = false and (
   category ilike '%comput%' or category ilike '%perif%' or category ilike '%mouse%'
   or category ilike '%pantalla%' or category ilike '%monitor%' or category ilike '%teclado%'
   or category ilike '%soporte%' or category ilike '%impres%' or category ilike '%tecnolog%'
   or name ilike '%comput%' or name ilike '%mouse%' or name ilike '%pantalla%'
   or name ilike '%monitor%' or name ilike '%teclado%' or name ilike '%soporte%' or name ilike '%impres%'
 );

-- 2) Helpers
create or replace function public.manages_dept(p_dept text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists(select 1 from public.departments d where d.name = p_dept and d.manager_id = auth.uid());
$$;

create or replace function public.req_needs_manager(p_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists(
    select 1 from public.request_items ri
    join public.inventory_items ii on ii.id = ri.item_id
    where ri.request_id = p_id and ii.requires_manager = true
  );
$$;

create or replace function public.can_manager_approve(p_dept text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.is_admin() or public.is_super() or public.manages_dept(p_dept);
$$;

grant execute on function public.manages_dept(text) to authenticated;
grant execute on function public.req_needs_manager(uuid) to authenticated;
grant execute on function public.can_manager_approve(text) to authenticated;

-- 3) Visibilidad: el gerente de área ve las solicitudes de su(s) departamento(s)
drop policy if exists requests_select_own_or_admin on public.requests;
create policy requests_select_own_or_admin on public.requests for select
  using ((user_id = auth.uid()) or public.can_manage_orders() or public.manages_dept(department));

drop policy if exists request_items_select on public.request_items;
create policy request_items_select on public.request_items for select
  using (exists (select 1 from public.requests r where r.id = request_items.request_id
    and (r.user_id = auth.uid() or public.can_manage_orders() or public.manages_dept(r.department))));

create or replace function public.can_access_thread(p_type text, p_id uuid)
returns boolean language plpgsql stable security definer set search_path to 'public' as $function$
declare owner uuid; dep text;
begin
  if p_type='request' then
    select user_id, department into owner, dep from public.requests where id=p_id;
    return owner=auth.uid() or public.can_manage_orders() or public.manages_dept(dep);
  elsif p_type='reservation' then
    select user_id into owner from public.reservations where id=p_id;
    return owner=auth.uid() or public.can_manage_rooms();
  elsif p_type='ticket' then
    select user_id into owner from public.support_tickets where id=p_id;
    return owner=auth.uid() or public.is_admin();
  end if;
  return false;
end; $function$;

-- 4) create_request: marca si necesita gerente
create or replace function public.create_request(p_note text, p_department text, p_items jsonb DEFAULT '[]'::jsonb, p_custom text DEFAULT ''::text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); v_id uuid; v_bad int; nm text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if length(trim(coalesce(p_note,'')))=0 and length(trim(coalesce(p_custom,'')))<10 then raise exception 'Falta justificación / descripción'; end if;
  insert into public.requests(user_id, note, department, custom, status)
    values (v_uid, coalesce(nullif(trim(p_note),''),'(solicitud personalizada)'), coalesce(p_department,''), coalesce(p_custom,''), 'pending')
    returning id into v_id;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb)) > 0 then
    insert into public.request_items(request_id,item_id,quantity)
      select v_id, (e->>'item_id')::uuid, (e->>'quantity')::int from jsonb_array_elements(p_items) e where (e->>'quantity')::int > 0;
    select count(*) into v_bad from public.request_items ri join public.inventory_items ii on ii.id=ri.item_id where ri.request_id=v_id and ii.is_active=false;
    if v_bad>0 then raise exception 'La solicitud incluye artículos inactivos'; end if;
  end if;
  update public.requests set needs_manager = public.req_needs_manager(v_id) where id = v_id;
  insert into public.messages(thread_type,thread_id,sender_id,body) values ('request', v_id, v_uid, coalesce(nullif(trim(p_custom),''), trim(p_note)));
  select coalesce(full_name,email) into nm from public.profiles where id=v_uid;
  perform public.notify_perm('manage_orders','Nueva solicitud de insumos', coalesce(nm,'')||' · '||coalesce(p_department,''), '/solicitudes', v_uid);
  perform public.log_activity('Solicitud','Creada', 'Departamento: '||coalesce(nullif(p_department,''),'—'));
  return v_id;
end; $function$;

-- 5) approve_request: 1er V°B°. Si necesita gerente -> manager_review (sin descontar stock)
create or replace function public.approve_request(p_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare falta text; owner uuid; who text; nm boolean; v_dept text; v_mgr uuid;
begin
  if not public.can_manage_orders() then raise exception 'No autorizado'; end if;
  select needs_manager, department, user_id into nm, v_dept, owner from public.requests where id=p_id and status='pending';
  if not found then raise exception 'Solicitud no encontrada o ya resuelta'; end if;
  select ii.name into falta from public.request_items ri join public.inventory_items ii on ii.id=ri.item_id where ri.request_id=p_id and ii.stock < ri.quantity limit 1;
  if falta is not null then raise exception 'No hay stock suficiente de "%"', falta; end if;
  select coalesce(full_name,email) into who from public.profiles where id=owner;

  if nm then
    update public.requests set status='manager_review', l1_by=auth.uid(), l1_at=now() where id=p_id and status='pending';
    insert into public.messages(thread_type,thread_id,sender_id,body,is_system)
      values('request',p_id,auth.uid(),'Aprobada por gestión. Enviada al gerente de área para autorizar la compra.',true);
    perform public.notify(owner,'Solicitud en revisión','Tu solicitud pasó el primer visto bueno; espera la autorización del gerente de área.','/solicitudes','info');
    select manager_id into v_mgr from public.departments where name=v_dept;
    if v_mgr is not null then
      perform public.notify(v_mgr,'Compra por autorizar', coalesce(who,'—')||' · '||coalesce(nullif(v_dept,''),'—'),'/solicitudes','info');
    end if;
    perform public.log_activity('Solicitud','En revisión de gerente', 'Solicitante: '||coalesce(who,'—')||' · '||coalesce(nullif(v_dept,''),'—'));
  else
    update public.requests set status='approved', l1_by=auth.uid(), l1_at=now() where id=p_id and status='pending';
    update public.inventory_items ii set stock=greatest(0, ii.stock - ri.quantity) from public.request_items ri where ri.item_id=ii.id and ri.request_id=p_id;
    insert into public.messages(thread_type,thread_id,sender_id,body,is_system) values('request',p_id,auth.uid(),'Solicitud aprobada. Stock descontado.',true);
    perform public.notify(owner,'Solicitud aprobada','Tu solicitud fue aprobada y el stock descontado.','/solicitudes','ok');
    perform public.log_activity('Solicitud','Aprobada', 'Solicitante: '||coalesce(who,'—'));
  end if;
end; $function$;

-- 6) 2da llave: gerente de área autoriza (o rechaza) la compra
create or replace function public.manager_approve_request(p_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_dept text; falta text; owner uuid; who text; l1 uuid;
begin
  select department, user_id, l1_by into v_dept, owner, l1 from public.requests where id=p_id and status='manager_review';
  if not found then raise exception 'La solicitud no está esperando autorización del gerente'; end if;
  if not public.can_manager_approve(v_dept) then raise exception 'No autorizado: no eres el gerente de esta área'; end if;
  if auth.uid() = l1 then raise exception 'La segunda autorización debe hacerla una persona distinta a la que dio el primer visto bueno'; end if;
  select ii.name into falta from public.request_items ri join public.inventory_items ii on ii.id=ri.item_id where ri.request_id=p_id and ii.stock < ri.quantity limit 1;
  if falta is not null then raise exception 'No hay stock suficiente de "%"', falta; end if;
  update public.requests set status='approved', mgr_by=auth.uid(), mgr_at=now() where id=p_id and status='manager_review';
  update public.inventory_items ii set stock=greatest(0, ii.stock - ri.quantity) from public.request_items ri where ri.item_id=ii.id and ri.request_id=p_id;
  insert into public.messages(thread_type,thread_id,sender_id,body,is_system) values('request',p_id,auth.uid(),'Compra autorizada por el gerente de área. Stock descontado.',true);
  select coalesce(full_name,email) into who from public.profiles where id=owner;
  perform public.notify(owner,'Compra autorizada','El gerente de área autorizó tu compra.','/solicitudes','ok');
  perform public.notify_perm('manage_orders','Compra autorizada por gerente', coalesce(who,'—')||' · '||coalesce(nullif(v_dept,''),'—'),'/solicitudes', null);
  perform public.log_activity('Solicitud','Compra autorizada (gerente)', 'Solicitante: '||coalesce(who,'—')||' · '||coalesce(nullif(v_dept,''),'—'));
end; $function$;

create or replace function public.manager_reject_request(p_id uuid, p_reason text DEFAULT ''::text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_dept text; owner uuid; who text;
begin
  select department, user_id into v_dept, owner from public.requests where id=p_id and status='manager_review';
  if not found then raise exception 'La solicitud no está esperando autorización del gerente'; end if;
  if not public.can_manager_approve(v_dept) then raise exception 'No autorizado: no eres el gerente de esta área'; end if;
  update public.requests set status='rejected', admin_note=coalesce(p_reason,'') where id=p_id and status='manager_review';
  insert into public.messages(thread_type,thread_id,sender_id,body) values('request',p_id,auth.uid(),'Compra rechazada por el gerente de área: '||coalesce(nullif(trim(p_reason),''),'sin motivo'));
  select coalesce(full_name,email) into who from public.profiles where id=owner;
  perform public.notify(owner,'Compra rechazada', coalesce(nullif(trim(p_reason),''),'Sin motivo'),'/solicitudes','bad');
  perform public.log_activity('Solicitud','Compra rechazada (gerente)', 'Solicitante: '||coalesce(who,'—'));
end; $function$;

grant execute on function public.manager_approve_request(uuid) to authenticated;
grant execute on function public.manager_reject_request(uuid, text) to authenticated;

-- 7) Asignar gerente de área a un departamento
create or replace function public.dept_set_manager(p_dept text, p_manager uuid DEFAULT NULL)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if not public.can_manage_users() then raise exception 'No autorizado'; end if;
  update public.departments set manager_id = p_manager where name = p_dept;
  if not found then raise exception 'Departamento no encontrado'; end if;
  perform public.log_activity('Departamento', case when p_manager is null then 'Gerente quitado' else 'Gerente asignado' end, p_dept);
end; $function$;

grant execute on function public.dept_set_manager(text, uuid) to authenticated;

-- 8) inventory_upsert: soportar requires_manager
create or replace function public.inventory_upsert(p jsonb)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v uuid; deps text[]; isnew boolean := (p->>'id') is null;
begin
  if not public.can_manage_supplies() then raise exception 'No autorizado'; end if;
  if length(trim(coalesce(p->>'name','')))=0 then raise exception 'El insumo necesita un nombre'; end if;
  if p ? 'departments' then deps := array(select jsonb_array_elements_text(p->'departments')); end if;
  if (p->>'id') is not null then
    update public.inventory_items set name=coalesce(p->>'name',name), category=coalesce(p->>'category',category),
      category_id=coalesce((p->>'category_id')::uuid,category_id), description=coalesce(p->>'description',description),
      stock=coalesce((p->>'stock')::int,stock), departments=coalesce(deps,departments),
      image_url=coalesce(p->>'image_url',image_url),
      country=coalesce(nullif(trim(p->>'country'),''),country),
      requires_manager=coalesce((p->>'requires_manager')::boolean, requires_manager),
      is_active=coalesce((p->>'is_active')::boolean,is_active) where id=(p->>'id')::uuid returning id into v;
  else
    insert into public.inventory_items(name,category,category_id,description,stock,departments,image_url,country,requires_manager)
      values(p->>'name',coalesce(p->>'category','General'),(p->>'category_id')::uuid,coalesce(p->>'description',''),coalesce((p->>'stock')::int,0),coalesce(deps,'{}'::text[]),coalesce(p->>'image_url',''),coalesce(nullif(trim(p->>'country'),''),'Chile'),coalesce((p->>'requires_manager')::boolean,false))
      returning id into v;
  end if;
  perform public.log_activity('Insumo', case when isnew then 'Creado' else 'Editado' end, coalesce(p->>'name',''));
  return v;
end; $function$;
