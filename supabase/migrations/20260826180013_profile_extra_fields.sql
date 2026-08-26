-- Campos extra de perfil para recopilar datos del personal.
alter table public.profiles
  add column if not exists work_mode text,          -- Presencial | Híbrido | Remoto
  add column if not exists emergency_name text,      -- contacto de emergencia: nombre
  add column if not exists emergency_phone text,     -- contacto de emergencia: teléfono
  add column if not exists birth_day smallint,       -- día de cumpleaños (1-31)
  add column if not exists birth_month smallint;     -- mes de cumpleaños (1-12)

-- Cada usuario actualiza SU propio perfil (los campos personales, no el rol/departamento).
create or replace function public.save_my_profile(
  p_phone text default null,
  p_work_mode text default null,
  p_emergency_name text default null,
  p_emergency_phone text default null,
  p_birth_day int default null,
  p_birth_month int default null
) returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  update public.profiles set
    phone = coalesce(nullif(trim(p_phone), ''), phone),
    work_mode = case when p_work_mode is null then work_mode else nullif(trim(p_work_mode), '') end,
    emergency_name = case when p_emergency_name is null then emergency_name else nullif(trim(p_emergency_name), '') end,
    emergency_phone = case when p_emergency_phone is null then emergency_phone else nullif(trim(p_emergency_phone), '') end,
    birth_day = case when p_birth_day is null then birth_day else nullif(p_birth_day, 0) end,
    birth_month = case when p_birth_month is null then birth_month else nullif(p_birth_month, 0) end
  where id = auth.uid();
end; $function$;

grant execute on function public.save_my_profile(text, text, text, text, int, int) to authenticated;
