CREATE TABLE public.compra_detalle (
  id integer NOT NULL DEFAULT nextval('compra_detalle_id_seq'::regclass),
  compra_id integer NOT NULL,
  producto_id integer NOT NULL,
  unidades integer NOT NULL,
  precio_unitario_compra numeric NOT NULL,
  porcentaje_iva numeric NOT NULL,
  CONSTRAINT compra_detalle_pkey PRIMARY KEY (id),
  CONSTRAINT compra_detalle_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id),
  CONSTRAINT compra_detalle_compra_id_fkey FOREIGN KEY (compra_id) REFERENCES public.compras(id)
);
CREATE TABLE public.compras (
  id integer NOT NULL DEFAULT nextval('compras_id_seq'::regclass),
  proyecto_id integer NOT NULL,
  fecha timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  estado USER-DEFINED NOT NULL,
  CONSTRAINT compras_pkey PRIMARY KEY (id),
  CONSTRAINT compras_proyecto_id_fkey FOREIGN KEY (proyecto_id) REFERENCES public.proyectos(id)
);
CREATE TABLE public.movimientos_stock (
  id integer NOT NULL DEFAULT nextval('movimientos_stock_id_seq'::regclass),
  producto_id integer NOT NULL,
  unidades integer NOT NULL,
  tipo_movimiento USER-DEFINED NOT NULL,
  ref_compra_detalle_id integer,
  ref_venta_detalle_id integer,
  fecha timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT movimientos_stock_pkey PRIMARY KEY (id),
  CONSTRAINT movimientos_stock_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id),
  CONSTRAINT movimientos_stock_ref_compra_detalle_id_fkey FOREIGN KEY (ref_compra_detalle_id) REFERENCES public.compra_detalle(id),
  CONSTRAINT movimientos_stock_ref_venta_detalle_id_fkey FOREIGN KEY (ref_venta_detalle_id) REFERENCES public.venta_detalle(id)
);
CREATE TABLE public.otros_ingresos_gastos (
  id integer NOT NULL DEFAULT nextval('otros_ingresos_gastos_id_seq'::regclass),
  proyecto_id integer NOT NULL,
  tipo USER-DEFINED NOT NULL,
  concepto character varying NOT NULL,
  descripcion text,
  importe numeric NOT NULL,
  porcentaje_iva numeric DEFAULT NULL::numeric,
  fecha timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT otros_ingresos_gastos_pkey PRIMARY KEY (id),
  CONSTRAINT otros_ingresos_gastos_proyecto_id_fkey FOREIGN KEY (proyecto_id) REFERENCES public.proyectos(id)
);
CREATE TABLE public.productos (
  id integer NOT NULL DEFAULT nextval('productos_id_seq'::regclass),
  proyecto_id integer NOT NULL,
  nombre character varying NOT NULL,
  CONSTRAINT productos_pkey PRIMARY KEY (id),
  CONSTRAINT productos_proyecto_id_fkey FOREIGN KEY (proyecto_id) REFERENCES public.proyectos(id)
);
CREATE TABLE public.proyectos (
  id integer NOT NULL DEFAULT nextval('proyectos_id_seq'::regclass),
  nombre character varying NOT NULL UNIQUE,
  activo boolean NOT NULL DEFAULT true,
  CONSTRAINT proyectos_pkey PRIMARY KEY (id)
);
CREATE TABLE public.venta_detalle (
  id integer NOT NULL DEFAULT nextval('venta_detalle_id_seq'::regclass),
  venta_id integer NOT NULL,
  producto_id integer NOT NULL,
  unidades integer NOT NULL,
  precio_unitario_venta numeric NOT NULL,
  porcentaje_iva numeric NOT NULL,
  CONSTRAINT venta_detalle_pkey PRIMARY KEY (id),
  CONSTRAINT venta_detalle_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES public.ventas(id),
  CONSTRAINT venta_detalle_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id)
);
CREATE TABLE public.ventas (
  id integer NOT NULL DEFAULT nextval('ventas_id_seq'::regclass),
  proyecto_id integer NOT NULL,
  fecha timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  canal character varying NOT NULL,
  estado USER-DEFINED NOT NULL,
  CONSTRAINT ventas_pkey PRIMARY KEY (id),
  CONSTRAINT ventas_proyecto_id_fkey FOREIGN KEY (proyecto_id) REFERENCES public.proyectos(id)
);
```

Vistas:

```sql
create or replace view public.vista_finanzas_diarias as
with
  ultimo_coste as (
    select distinct on (cd.producto_id)
      cd.producto_id,
      cd.precio_unitario_compra as coste_ultimo_con_iva
    from compra_detalle cd
    join compras c on cd.compra_id = c.id
    order by cd.producto_id, c.fecha desc
  ),
  unificado as (
    select
      v.proyecto_id,
      v.fecha::date as dia,
      -- Solo sumamos ingresos si la venta NO ha sido devuelta ni reembolsada
      case when v.estado = 'enviada' then vd.unidades::numeric * vd.precio_unitario_venta else 0::numeric end as ingreso_v,
      0::numeric as gasto_total,
      -- El beneficio solo cuenta para ventas enviadas
      case when v.estado = 'enviada' then (vd.unidades::numeric * (vd.precio_unitario_venta - COALESCE(uc.coste_ultimo_con_iva, 0::numeric))) else 0::numeric end as beneficio_v,
      0::numeric as gasto_o_base,
      0::numeric as iva_s,
      -- El IVA solo se repercute si la venta es efectiva
      case when v.estado = 'enviada' then (vd.unidades::numeric * vd.precio_unitario_venta * (vd.porcentaje_iva / (100::numeric + vd.porcentaje_iva))) else 0::numeric end as iva_r
    from
      venta_detalle vd
      join ventas v on vd.venta_id = v.id
      left join ultimo_coste uc on vd.producto_id = uc.producto_id

    union all

    select
      c.proyecto_id,
      c.fecha::date as dia,
      0::numeric as ingreso_v,
      -- Solo cuentan las compras recibidas (no las canceladas)
      case when c.estado = 'recibida' then cd.unidades::numeric * cd.precio_unitario_compra else 0::numeric end as gasto_total,
      0::numeric as beneficio_v,
      0::numeric as gasto_o_base,
      case when c.estado = 'recibida' then cd.unidades::numeric * cd.precio_unitario_compra * (cd.porcentaje_iva / (100::numeric + cd.porcentaje_iva)) else 0::numeric end as iva_s,
      0::numeric as iva_r
    from
      compra_detalle cd
      join compras c on cd.compra_id = c.id

    union all

    select
      proyecto_id,
      fecha::date as dia,
      (case when tipo = 'ingreso' then importe else 0 end) as ingreso_v,
      (case when tipo = 'gasto' then importe else 0 end) as gasto_total,
      0 as beneficio_v,
      (case when tipo = 'gasto' then importe else 0 end) as gasto_o_base,
      (case when tipo = 'gasto' then importe * (COALESCE(porcentaje_iva, 0) / (100 + COALESCE(porcentaje_iva, 0))) else 0 end) as iva_s,
      (case when tipo = 'ingreso' then importe * (COALESCE(porcentaje_iva, 0) / (100 + COALESCE(porcentaje_iva, 0))) else 0 end) as iva_r
    from
      otros_ingresos_gastos
  )
select
  u.dia, u.proyecto_id, p.nombre as nombre_proyecto,
  sum(u.ingreso_v) as ingresos,
  sum(u.gasto_total) as gastos,
  sum(u.ingreso_v) - sum(u.gasto_total) as balance,
  sum(u.beneficio_v) - sum(u.gasto_o_base) as urp,
  sum(u.iva_s) as iva_soportado,
  sum(u.iva_r) as iva_repercutido,
  sum(u.iva_r) - sum(u.iva_s) as saldo_iva
from unificado u
join proyectos p on u.proyecto_id = p.id
group by u.dia, u.proyecto_id, p.nombre;

  --

  create view public.vista_stock_final as
with
  sub as (
    select
      p.proyecto_id,
      proy.nombre as nombre_proyecto,
      p.id as producto_id,
      p.nombre as nombre_producto,
      COALESCE(
        (
          select
            sum(m.unidades) as sum
          from
            movimientos_stock m
          where
            m.producto_id = p.id
        ),
        0::bigint
      ) as stock_actual,
      COALESCE(
        (
          select
            avg(cd.precio_unitario_compra) as avg
          from
            compra_detalle cd
            join compras c on cd.compra_id = c.id
          where
            cd.producto_id = p.id
            and c.fecha >= (now() - '60 days'::interval)
        ),
        (
          select
            avg(cd.precio_unitario_compra) as avg
          from
            compra_detalle cd
          where
            cd.producto_id = p.id
        ),
        0::numeric
      ) as coste_ud,
      COALESCE(
        (
          select
            avg(vd.precio_unitario_venta) as avg
          from
            venta_detalle vd
            join ventas v on vd.venta_id = v.id
          where
            vd.producto_id = p.id
            and v.fecha >= (now() - '30 days'::interval)
        ),
        (
          select
            avg(vd.precio_unitario_venta) as avg
          from
            venta_detalle vd
          where
            vd.producto_id = p.id
        ),
        0::numeric
      ) as venta_ud,
      (
        select
          COALESCE(sum(vd.unidades), 0::bigint) as "coalesce"
        from
          venta_detalle vd
          join ventas v on vd.venta_id = v.id
        where
          vd.producto_id = p.id
          and v.fecha >= (now() - '30 days'::interval)
      ) as num_ventas_30d
    from
      productos p
      join proyectos proy on p.proyecto_id = proy.id
  )
select
  proyecto_id,
  nombre_proyecto,
  producto_id,
  nombre_producto,
  stock_actual,
  coste_ud,
  venta_ud,
  num_ventas_30d,
  venta_ud - coste_ud as beneficio_ud,
  (venta_ud - coste_ud) * num_ventas_30d::numeric as beneficio_total_30d,
  stock_actual::numeric * venta_ud as valor_stock,
  num_ventas_30d::numeric / 30.0 as venta_diaria_promedio,
  case
    when (num_ventas_30d::numeric / 30.0) > 0::numeric then stock_actual::numeric / (num_ventas_30d::numeric / 30.0)
    else 999::numeric
  end as dias_stock_restante
from
  sub;

  -- Triggrs:

  
BEGIN
    IF (TG_OP = 'INSERT') THEN
        INSERT INTO movimientos_stock (producto_id, unidades, tipo_movimiento, ref_compra_detalle_id)
        VALUES (NEW.producto_id, NEW.unidades, 'compra', NEW.id);
    ELSIF (TG_OP = 'UPDATE') THEN
        UPDATE movimientos_stock 
        SET unidades = NEW.unidades, producto_id = NEW.producto_id
        WHERE ref_compra_detalle_id = NEW.id;
    END IF;
    RETURN NEW;
END;


BEGIN
    IF (TG_OP = 'INSERT') THEN
        INSERT INTO movimientos_stock (producto_id, unidades, tipo_movimiento, ref_venta_detalle_id)
        VALUES (NEW.producto_id, -NEW.unidades, 'venta', NEW.id);
    ELSIF (TG_OP = 'UPDATE') THEN
        UPDATE movimientos_stock 
        SET unidades = -NEW.unidades, producto_id = NEW.producto_id
        WHERE ref_venta_detalle_id = NEW.id;
    END IF;
    RETURN NEW;
END;

-- Database Enumerated Types

/*
- tipo_movimiento: compra, venta, devolucion_vta, ajuste manual, devolucion_com

- estado_compra: pendiente, recibida, cancelada

- tipo_transaccion: ingreso, gasto

- estado_venta: pendiente, enviada, devuelta, reembolsada
*/