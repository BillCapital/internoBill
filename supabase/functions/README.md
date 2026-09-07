# Respaldos del código desplegado en Supabase Edge Functions (fecha: 2026-09-07)
Estos archivos son copias exactas del código actualmente desplegado; versiones: gateway v46, ms-users v8, ms-groups v2, ms-diag v2, calendar v17, calendar-webhook v7, calendar-subscribe v6, calendar-availability v5, notify v11, notify-email v5, link-preview v3.
El deploy real de estas funciones se hace vía MCP (deploy_edge_function) o desde el dashboard de Supabase, no desde este directorio.
Redeployar cualquiera de estas funciones requiere las variables de entorno/secrets ya configuradas en Supabase (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INTERNAL_KEY, NOTIFY_KEY, MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_NOTIFY_FROM, APP_URL, etc.).
No modificar estos archivos a mano si se quiere que sigan reflejando lo desplegado.
