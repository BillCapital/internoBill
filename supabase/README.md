# Migraciones de Supabase

Estas migraciones documentan los cambios de base de datos del flujo de **aprobación de compras
tecnológicas** (proyecto Supabase `qibxnwlrbartrlfycqmv`). Ya están aplicadas en la base de
producción; se versionan aquí para dejar constancia del SQL en el repositorio.

## Orden e historia del flujo de aprobación

1. `20260824165817_dual_approval_tech_supplies.sql` — 2 llaves: gestión + gerente de área.
2. `20260824171940_tech_dual_approvers.sql` — la 2ª fase pasa a exigir a **todos** los aprobadores
   de tecnología (TI + RRHH).
3. `20260825193536_three_key_area_manager_approval.sql` — **estado actual (3 llaves):** gerente de
   área del departamento solicitante **+** aprobadores de tecnología (Sistema / TI y Juan / RRHH),
   des-duplicado por persona. Operaciones queda con 2 llaves (Juan es a la vez RRHH y gerente de
   Operaciones); Gerencia queda con las 2 llaves de tecnología.

> Las migraciones 1 y 2 quedan superadas por la 3 (redefinen `approve_request` y
> `tech_approve_request`). Se conservan para reflejar la historia real de cambios. **No re-ejecutar
> 1 ni 2 sobre la base actual**, o revertirían la lógica a versiones anteriores.

## Nota

Este directorio contiene solo las migraciones del flujo de aprobación, no el historial completo
del esquema. Para bajar todas las migraciones desde Supabase se necesita el CLI:

```bash
supabase link --project-ref qibxnwlrbartrlfycqmv
supabase db pull
```
