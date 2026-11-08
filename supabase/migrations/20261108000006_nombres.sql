-- Nombre más claro para el motivo de sistema de las comisiones que paga la agencia
-- (se lee como "Pago pendiente: Comisión a vendedor o referido").
update public.motivos_caja
set nombre = 'Comisión a vendedor o referido'
where codigo = 'comision_pagada' and nombre = 'Comisión pagada';
