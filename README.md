# Level Cars · Administración

Sistema interno de Level Cars para registrar stock, ventas, señas, caja y reportes.
Hecho con Next.js 16, Tailwind CSS 4 y Supabase (Postgres con seguridad por filas).

## Qué hace

- **Stock**: autos, motos y teléfonos propios, en consignación o de otras agencias (intermediación). Fotos, gastos por bien, alertas de antigüedad y de vencimiento de consignación.
- **Ventas** con pagos combinados: efectivo, transferencia, financiación (con o sin comisión de la financiera) y vehículos o bienes que entran como parte de pago y pasan al stock.
- **Señas y reservas**: se descuentan al vender, o se retienen o devuelven (total o parcial) si la venta no se hace.
- **Comisiones** a vendedores y referidos (monto fijo, % del precio o % de la ganancia), editables en cada operación.
- **Caja** en pesos y dólares, efectivo y banco, con motivos, pendientes y gastos fijos.
- **Reportes**: resultado mensual, ventas por canal de entrada, por tipo de bien, por vendedor y por forma de pago.

## Puesta en marcha

1. Crear un proyecto en Supabase y aplicar, en orden, las migraciones de `supabase/migrations/`.
2. Copiar `.env.example` como `.env.local` y completar la URL y la clave **publicable** del proyecto.
3. En Supabase > Authentication: crear el usuario administrador y **desactivar los registros públicos**.
4. Darle acceso de administrador (SQL Editor):
   ```sql
   insert into public.administradores (user_id, nombre)
   select id, 'Tu nombre' from auth.users where email = 'tu@email.com';
   ```
5. `npm install` y `npm run dev`.

## Seguridad

- Nunca se sube ninguna clave: `.env*` está ignorado salvo `.env.example`. La app rechaza la clave secreta (`service_role`) si alguien la configura por error.
- Toda la seguridad de los datos vive en la base: RLS forzado en todas las tablas, solo los administradores activos ven o modifican algo, y las operaciones de dinero pasan por funciones que validan cada regla. Cada cambio queda en la tabla de auditoría.
- Cada página y cada acción del servidor vuelve a verificar que el usuario sea administrador.
- Encabezados de seguridad estrictos (CSP con nonce, HSTS, sin iframes) y validación de todos los datos con zod.
- Fotos en un bucket privado, con URLs firmadas que vencen en una hora y control del tipo real del archivo.

## Pruebas

- `npm run lint` y `npx tsc --noEmit`.
- `npm run test:db`: pruebas de seguridad y de reglas de negocio contra un Postgres **local** descartable.
- `tests/e2e/recorrido.mjs`: recorrido completo en un navegador real (escritorio y celular). Las credenciales se pasan por variables de entorno; ver el encabezado del archivo.
- En GitHub, cada cambio corre auditoría de dependencias, tipos, lint, compilación, búsqueda de claves filtradas y las pruebas de base de datos.

## Publicación

La app se publica en Vercel con cada cambio en `main`. En el proyecto de Vercel solo se cargan
las dos variables públicas de `.env.example` (URL y clave publicable). Nunca se carga la clave secreta.

Las funciones de Vercel corren en San Pablo (`gru1`, ver `vercel.json`), la misma región que la base de
Supabase (`sa-east-1`): cada consulta viaja unos pocos milisegundos en lugar de cruzar a Estados Unidos.
