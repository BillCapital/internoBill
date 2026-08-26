-- Edición masiva de equipos: aplica un parche (campos en lista blanca) a un conjunto de ids.
-- Campos soportados: condition (estado), location (ubicación), assigned_to_name / assigned_to_email
-- (asignación a persona o, para secciones por departamento, el nombre del depto),
-- y maint_lote (grupo de mantenimiento, guardado en attributes).
create or replace function public.equipment_bulk_update(p_ids uuid[], p_patch jsonb)
returns int language plpgsql security definer set search_path to 'public' as $function$
declare n int;
begin
  if not public.can_manage_inventory() then raise exception 'No autorizado'; end if;
  if p_ids is null or array_length(p_ids, 1) is null then return 0; end if;

  update public.equipment e set
    condition = case when p_patch ? 'condition' then nullif(p_patch->>'condition','') else e.condition end,
    location  = case when p_patch ? 'location'  then p_patch->>'location' else e.location end,
    assigned_to_name  = case when p_patch ? 'assigned_to_name'  then p_patch->>'assigned_to_name'  else e.assigned_to_name end,
    assigned_to_email = case when p_patch ? 'assigned_to_email' then p_patch->>'assigned_to_email' else e.assigned_to_email end,
    attributes = case
      when p_patch ? 'maint_lote' and coalesce(p_patch->>'maint_lote','') <> ''
        then jsonb_set(coalesce(e.attributes,'{}'::jsonb), '{maint_lote}', to_jsonb(p_patch->>'maint_lote'))
      when p_patch ? 'maint_lote'  -- valor vacío = quitar del grupo
        then coalesce(e.attributes,'{}'::jsonb) - 'maint_lote'
      else e.attributes end
  where e.id = any(p_ids) and e.returned_at is null;

  get diagnostics n = row_count;
  perform public.log_activity('Equipo', 'Edición masiva', n || ' equipo(s) actualizados');
  return n;
end; $function$;

grant execute on function public.equipment_bulk_update(uuid[], jsonb) to authenticated;
