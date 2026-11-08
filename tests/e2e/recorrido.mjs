// Prueba de punta a punta del flujo principal con un navegador real.
// Uso: E2E_URL=http://localhost:3000 E2E_EMAIL=... E2E_PASSWORD=... node tests/e2e/recorrido.mjs
// Las credenciales se pasan por variables de entorno: nunca se escriben en el código.
import { createRequire } from "node:module";
// playwright puede estar instalado global (NODE_PATH) o como dependencia local
const { chromium } = createRequire(import.meta.url)("playwright");

const URL = process.env.E2E_URL ?? "http://localhost:3000";
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const CAPTURAS = process.env.E2E_CAPTURAS; // carpeta opcional para guardar capturas
// opcional: un usuario válido de Supabase que NO es administrador
const INTRUSO_EMAIL = process.env.E2E_INTRUSO_EMAIL;
const INTRUSO_PASSWORD = process.env.E2E_INTRUSO_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Faltan E2E_EMAIL / E2E_PASSWORD");

const sufijo = Date.now().toString().slice(-6);
const errores = [];
let paso = 0;

function ok(msg) { console.log(`  ✓ ${msg}`); }
async function captura(page, nombre) {
  if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/${String(++paso).padStart(2, "0")}-${nombre}.png`, fullPage: true });
}

const browser = await chromium.launch();

if (INTRUSO_EMAIL && INTRUSO_PASSWORD) {
  console.log("\n== usuario sin permiso de administrador");
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${URL}/login`);
  await page.fill("#email", INTRUSO_EMAIL);
  await page.fill("#password", INTRUSO_PASSWORD);
  await page.click("button[type=submit]");
  await page.getByText("Tu usuario no tiene acceso al sistema.").waitFor();
  await page.goto(`${URL}/caja`);
  if (!page.url().includes("/login")) throw new Error("Un usuario no administrador pudo entrar a /caja");
  ok("usuario sin permiso es rechazado y su sesión se cierra");
  await ctx.close();
}
for (const dispositivo of ["escritorio", "celular"]) {
  console.log(`\n== ${dispositivo}`);
  const ctx = await browser.newContext(
    dispositivo === "celular" ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1366, height: 900 } },
  );
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") errores.push(`[${dispositivo}] consola: ${m.text()}`); });
  page.on("pageerror", (e) => errores.push(`[${dispositivo}] js: ${e.message}`));
  page.on("dialog", (d) => d.accept());

  // 1. Sin sesión, redirige a login
  await page.goto(`${URL}/stock`);
  if (!page.url().includes("/login")) throw new Error("No redirigió a login sin sesión");
  ok("sin sesión redirige a /login");

  // 2. Contraseña incorrecta
  await page.fill("#email", EMAIL);
  await page.fill("#password", "incorrecta-123");
  await page.click("button[type=submit]");
  await page.getByText("Email o contraseña incorrectos").waitFor();
  ok("rechaza contraseña incorrecta");
  await captura(page, `${dispositivo}-login`);

  // 3. Login correcto
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname === "/", { waitUntil: "commit" });
  await page.getByText("Resultado del mes").waitFor();
  ok("login correcto, inicio visible");
  await captura(page, `${dispositivo}-inicio`);

  if (dispositivo === "escritorio") {
    // 4. Personas: cliente y vendedor
    await page.goto(`${URL}/personas`);
    for (const [nombre, rol] of [[`Cliente E2E ${sufijo}`, "es_cliente"], [`Vendedor E2E ${sufijo}`, "es_vendedor"]]) {
      await page.getByRole("button", { name: "Agregar persona" }).click();
      const dlg = page.locator("dialog[open]");
      await dlg.locator("input[name=nombre]").fill(nombre);
      await dlg.locator("input[name=telefono]").fill("+54 9 11 5555-0000");
      if (rol === "es_vendedor") {
        await dlg.locator("input[name=es_cliente]").uncheck();
        await dlg.locator("input[name=es_vendedor]").check();
      }
      await dlg.getByRole("button", { name: "Guardar" }).click();
      await page.locator("dialog[open]").waitFor({ state: "detached" }).catch(() => {});
      await page.getByText(nombre).first().waitFor();
    }
    ok("personas creadas");
    await captura(page, "personas");

    // 5. Cargar un auto propio
    await page.goto(`${URL}/stock/nuevo`);
    await page.selectOption("#tipo", "auto");
    await page.fill("#marca", "Ford");
    await page.fill("#modelo", `Focus E2E ${sufijo}`);
    await page.fill("#anio", "2018");
    await page.selectOption("#moneda", "ARS");
    await page.fill("#costo", "7.000.000");
    await page.fill("#precio_publicado", "10.000.000");
    await page.check("input[name=registrar_egreso]");
    await captura(page, "nuevo-bien");
    await page.getByRole("button", { name: "Guardar bien" }).click();
    await page.waitForURL(/\/stock\/\d+$/);
    const bienId = page.url().split("/").pop();
    await page.getByText(`Focus E2E ${sufijo}`).first().waitFor();
    ok(`bien creado (#${bienId})`);

    // 6. Cargar un gasto al bien
    await page.selectOption("#g_motivo", { label: "Arreglos y mecánica" });
    await page.fill("#g_monto", "100.000");
    await page.selectOption("#g_moneda", "ARS");
    await page.getByRole("button", { name: "Cargar gasto" }).click();
    await page.getByText("Gasto cargado.").waitFor();
    ok("gasto cargado");
    await captura(page, "detalle-bien");

    // 7. Vender: moto como parte de pago + efectivo, comisión 10% de ganancia al vendedor
    await page.getByRole("link", { name: "Vender" }).click();
    await page.waitForURL(/operaciones\/nueva/);
    await page.selectOption("#cliente", { label: `Cliente E2E ${sufijo}` });
    await page.selectOption("#canal", { label: "Facebook" });
    await page.selectOption("#vendedor", { label: `Vendedor E2E ${sufijo}` });
    await page.fill("#precio", "10.000.000");
    await page.locator("[id^=pm_]").first().fill("7.000.000");
    await page.getByRole("button", { name: "Vehículo / bien" }).click();
    const pagoBien = page.locator("li", { has: page.locator("[id^=bt_]") });
    await pagoBien.locator("[id^=pm_]").fill("3.000.000");
    await pagoBien.locator("[id^=bmarca_]").fill("Honda");
    await pagoBien.locator("[id^=bmodelo_]").fill(`CB190 E2E ${sufijo}`);
    await page.getByRole("button", { name: /Comisión a pagar/ }).click();
    await page.locator("[id^=cv_]").fill("10");
    await page.getByText("Los pagos cubren el precio").waitFor();
    // ganancia estimada: 10M - 7M - 0.1M = 2.9M; comisión 10% = 290.000 -> 2.610.000
    await page.getByText("$ 2.610.000").first().waitFor();
    ok("resumen en vivo correcto (ganancia estimada $ 2.610.000)");
    await captura(page, "nueva-venta");
    await page.getByRole("button", { name: "Confirmar venta" }).click();
    await page.waitForURL(/\/operaciones\/\d+\?nueva=1/);
    await page.getByText("Venta registrada").waitFor();
    await page.getByText("$ 2.610.000").first().waitFor();
    ok("venta registrada con ganancia neta $ 2.610.000");
    await captura(page, "operacion");

    // 8. La moto entró al stock
    await page.goto(`${URL}/stock`);
    await page.getByText(`Honda CB190 E2E ${sufijo}`).waitFor();
    ok("la moto recibida está en el stock");
    await captura(page, "stock");

    // 9. Caja con pendientes, reportes, configuración
    await page.goto(`${URL}/caja?pendientes=1`);
    await page.getByText("Comisión a vendedor o referido").first().waitFor();
    ok("comisión del vendedor figura como pendiente en caja");
    await captura(page, "caja");
    await page.goto(`${URL}/reportes?moneda=ARS`);
    await page.getByText("Por canal de entrada").waitFor();
    await page.getByText("Facebook").first().waitFor();
    ok("reportes por canal");
    await captura(page, "reportes");
    // 10. Auto en dólares pagado en parte con pesos (cotización 1.000)
    await page.goto(`${URL}/stock/nuevo`);
    await page.selectOption("#tipo", "auto");
    await page.fill("#marca", "VW");
    await page.fill("#modelo", `Amarok E2E ${sufijo}`);
    await page.selectOption("#moneda", "USD");
    await page.fill("#costo", "10.000");
    await page.getByRole("button", { name: "Guardar bien" }).click();
    await page.waitForURL(/\/stock\/\d+$/);
    await page.getByRole("link", { name: "Vender" }).click();
    await page.waitForURL(/operaciones\/nueva/);
    await page.selectOption("#cliente", { label: `Cliente E2E ${sufijo}` });
    await page.fill("#precio", "12.000");
    const primerPago = page.locator("li", { has: page.locator("[id^=pm_]") }).first();
    await primerPago.getByLabel("Moneda del pago").selectOption("ARS");
    await page.locator("#cot").fill("1.000");
    await primerPago.locator("[id^=pm_]").fill("5.000.000");
    await page.getByRole("button", { name: "Efectivo" }).last().click();
    const segundoPago = page.locator("li", { has: page.locator("[id^=pm_]") }).nth(1);
    await segundoPago.getByRole("button", { name: "Completar saldo" }).click();
    if ((await segundoPago.locator("[id^=pm_]").inputValue()) !== "7000") throw new Error("Completar saldo no calculó US$ 7000");
    await page.getByText("Los pagos cubren el precio").waitFor();
    await page.getByRole("button", { name: "Confirmar venta" }).click();
    await page.waitForURL(/\/operaciones\/\d+\?nueva=1/);
    await page.getByText("US$ 2.000").first().waitFor();
    await page.getByText("$ 5.000.000").first().waitFor();
    ok("venta en dólares con pago en pesos (ganancia US$ 2.000)");
    await captura(page, "operacion-mixta");

    await page.goto(`${URL}/configuracion`);
    await page.getByText("Plazos y alertas").waitFor();
    ok("configuración");
  } else {
    for (const ruta of ["/", "/stock", "/operaciones", "/caja", "/reportes", "/operaciones/nueva", "/personas", "/configuracion"]) {
      await page.goto(`${URL}${ruta}`);
      await page.waitForLoadState("networkidle");
      const ancho = await page.evaluate(() => document.documentElement.scrollWidth);
      if (ancho > 392) errores.push(`[celular] ${ruta} tiene scroll horizontal (${ancho}px)`);
      await captura(page, `celular${ruta.replaceAll("/", "-")}`);
    }
    ok("pantallas en celular sin scroll horizontal");
  }

  // Cerrar sesión
  await page.goto(`${URL}/`);
  await ctx.close();
}
await browser.close();

if (errores.length) {
  console.error("\nErrores detectados:\n" + errores.join("\n"));
  process.exit(1);
}
console.log("\nRECORRIDO COMPLETO SIN ERRORES");
