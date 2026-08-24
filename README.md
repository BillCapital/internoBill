# Inventario · Calendario · BillCapital

Aplicación web interna de BillCapital para la gestión de inventario, computadores y
periféricos, insumos y solicitudes, salas y reservas, usuarios de Microsoft 365,
roles y permisos, manuales internos y más.

Construida con **React + Vite** y **Supabase** (base de datos Postgres, RLS,
funciones RPC, Storage y Edge Functions).

## Requisitos

- [Node.js](https://nodejs.org/) 18 o superior (incluye `npm`).

## Puesta en marcha

```bash
# 1) Instalar dependencias
npm install

# 2) Entorno de desarrollo (recarga en caliente)
npm run dev
# Abre http://localhost:5173

# 3) Compilar para producción
npm run build      # genera la carpeta dist/

# 4) Previsualizar el build de producción
npm run preview
```

En Windows también puedes iniciar el servidor de desarrollo con doble clic en
`Iniciar servidor.bat`.

## Configuración (opcional)

La app ya viene lista para conectarse al proyecto de Supabase. La URL y la clave
**publishable/anon** están como valores por defecto en `src/lib/supabase.js`
(la clave anon es pública por diseño; el acceso a los datos está protegido por las
políticas RLS en la base de datos).

Si quieres apuntar a otro entorno, copia `.env.example` a `.env` y ajusta:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

## Estructura

```
src/
  pages/        Páginas (Inventario, Insumos, Solicitudes, Usuarios, Roles,
                Manuales, Salas, Soporte, etc.)
  components/   Componentes compartidos (Layout, Chat, ImagePicker, …)
  context/      AuthContext (sesión y permisos)
  lib/          Cliente de Supabase, helpers de UI, departamentos, imágenes
  styles.css    Estilos globales
```

## Despliegue

Compila con `npm run build` y publica el contenido de `dist/` en tu hosting
estático. El backend (base de datos, RPC, Storage y Edge Functions) vive en
Supabase y no forma parte de este repositorio.
