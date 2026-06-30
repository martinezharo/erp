// Translation dictionaries for the app (Spanish base + English).
// Keys are flat and namespaced. Used on the server (frontmatter / API routes)
// and on the client (the active-language dict is injected into `window`).

export const defaultLang = "en";

export type Lang = "es" | "en";

export const languages: Record<Lang, string> = {
  es: "Español",
  en: "English",
};

type Dict = Record<string, string>;

const es: Dict = {
  // Common
  "common.start": "Comenzar",
  "common.save": "Guardar",
  "common.cancel": "Cancelar",
  "common.edit": "Editar",
  "common.delete": "Eliminar",
  "common.loading": "Cargando...",
  "common.loadingData": "Cargando datos...",
  "common.loadingMovements": "Cargando movimientos...",
  "common.select": "Seleccionar",
  "common.products": "Productos",
  "common.addProduct": "Añadir Producto",
  "common.connectionError": "Error de conexión",
  "common.errorLoadingData": "Error cargando datos",
  "common.noProjectFirst": "Selecciona un proyecto primero",
  "common.saveErrorPrefix": "Error al guardar:",
  "common.unknown": "Desconocido",
  "common.totalAmountOptional": "Importe Total (Opcional)",

  // Item rows (sales / purchases)
  "item.product": "Producto",
  "item.units": "Uds",
  "item.price": "Precio",
  "item.vat": "IVA %",
  "item.totalEur": "Total (€)",

  // Navigation
  "nav.home": "Inicio",
  "nav.stock": "Stock",
  "nav.transactions": "Transacciones",
  "nav.history": "Historial",

  // Layout
  "layout.signOut": "Cerrar Sesión",
  "layout.dashboard": "Dashboard",

  // Page titles (used in <title> and the header chip via split("|")[1])
  "title.dashboard": "OlivERP | Dashboard",
  "title.stock": "OlivERP | Stock",
  "title.transactions": "OlivERP | Transacciones",
  "title.history": "OlivERP | Historial",
  "title.login": "OlivERP | Iniciar Sesión",

  // Demo banner
  "demo.title": "Modo Demo",
  "demo.full":
    "Estás viendo datos de ejemplo. Configura las variables de entorno de Supabase para conectar con datos reales.",
  "demo.short": "Datos de ejemplo.",

  // Finance labels (shared)
  "finance.income": "Ingresos",
  "finance.expenses": "Gastos",
  "finance.balance": "Balance",
  "finance.vatBalance": "Saldo IVA",
  "finance.urp": "URP",
  "finance.vatSupported": "Soportado",
  "finance.vatCharged": "Repercutido",

  // Home / dashboard quick actions
  "index.newSale": "Nueva Venta",
  "index.newSaleDesc": "Registrar salida de stock y generar ingreso",
  "index.newPurchase": "Nueva Compra",
  "index.newPurchaseDesc": "Registrar entrada de mercancía",
  "index.incomeExpense": "Ingreso / Gasto",
  "index.incomeExpenseDesc": "Registrar movimientos varios",

  // Login
  "login.welcome": "Bienvenido",
  "login.subtitle": "Inicia sesión para acceder al ERP",
  "login.email": "Email",
  "login.password": "Contraseña",
  "login.signIn": "Iniciar Sesión",
  "login.forgot": "¿Olvidaste tu contraseña?",

  // Stock page + table
  "stock.title": "Inventario & Stock",
  "stock.subtitle": "Gestión de productos y valoración de existencias",
  "stock.newProduct": "Nuevo Producto",
  "stock.totalProducts": "Total Productos",
  "stock.unitsInStock": "Unidades en Stock",
  "stock.totalValue": "Valor Total Stock",
  "stock.totalSaleValue": "Venta",
  "stock.totalPurchaseValue": "Compra",
  "stock.colProduct": "Producto",
  "stock.colStock": "Stock",
  "stock.colValue": "Valor Stock",
  "stock.colUnit": "Unitario (C/V)",
  "stock.colProfitU": "Beneficio U.",
  "stock.colProfit30": "Beneficio 30d",
  "stock.colStatus": "Estado",
  "stock.noData": "No hay datos de stock para este proyecto.",
  "stock.outOfStock": "Agotado",
  "stock.noStatus": "Sin datos",
  "stock.days": "{n} días",
  "stock.overYear": "+1 año",
  "stock.buyLabel": "C:",
  "stock.sellLabel": "V:",

  // Transactions page
  "transactions.title": "Transacciones",
  "transactions.subtitle": "Finanzas diarias, ingresos y gastos",
  "transactions.viewDaily": "Modo diario",
  "transactions.daily": "Diario",
  "transactions.viewList": "Modo transacciones",
  "transactions.list": "Transacciones",

  // Transaction filters
  "filters.search": "Buscar concepto o producto...",
  "filters.type": "Tipo",
  "filters.allTypes": "Todos los tipos",
  "filters.typeVenta": "Ventas",
  "filters.typeCompra": "Compras",
  "filters.typeIngreso": "Ingresos",
  "filters.typeGasto": "Gastos",
  "filters.channel": "Canal",
  "filters.allChannels": "Todos los canales",
  "filters.more": "Filtros",
  "filters.dateRange": "Rango de fechas",
  "filters.dateFrom": "Desde",
  "filters.dateTo": "Hasta",
  "filters.amountRange": "Rango de importe",
  "filters.amountMin": "Mínimo",
  "filters.amountMax": "Máximo",
  "filters.clear": "Limpiar filtros",
  "filters.apply": "Aplicar",
  "filters.noResults": "No hay transacciones que coincidan con los filtros.",

  // History page
  "history.title": "Historial Financiero",
  "history.subtitle": "Visualiza el rendimiento financiero agrupado por periodos.",
  "history.selectProject": "Selecciona un proyecto para ver su historial.",
  "history.totalHistoric": "Total Histórico",
  "history.viewMonths": "Meses",
  "history.viewQuarters": "Trimestres",
  "history.viewYears": "Años",
  "history.viewTotal": "Total",
  "history.period": "Periodo",

  // Dashboard stats
  "dashboard.balanceMonth": "Balance {month}",
  "dashboard.balanceQuarter": "Balance Trimestre {quarter}",
  "dashboard.projection": "Proyección {month}",
  "dashboard.estimatedIncome": "Ingresos Estimados",
  "dashboard.day": "Día {current}/{total}",
  "dashboard.estimatedUrp": "URP Estimado",
  "dashboard.vatSupportedTip": "Soportado (IVA deducible en compras)",
  "dashboard.vatChargedTip": "Repercutido (IVA cobrado en ventas)",
  "dashboard.quarterShort": "T{n}",

  // Project selector
  "project.select": "Seleccionar Proyecto",
  "project.mine": "Mis Proyectos",
  "project.none": "No hay proyectos",
  "project.new": "Nuevo Proyecto",

  // Pagination
  "pagination.previous": "Anterior",
  "pagination.next": "Siguiente",

  // Revenue chart
  "chart.title": "Evolución de Ingresos",
  "chart.totalPeriod": "Total del periodo:",
  "chart.days7": "7 días",
  "chart.days30": "30 días",
  "chart.days90": "90 días",

  // Transactions list
  "txn.noTransactions": "No hay transacciones registradas para este proyecto.",
  "txn.noDetails": "No hay movimientos detallados",
  "txn.colDate": "Fecha",
  "txn.colType": "Tipo",
  "txn.colConcept": "Concepto / Productos",
  "txn.colUnits": "Uds",
  "txn.colAmount": "Importe",
  "txn.colChannel": "Canal",
  "txn.colStatus": "Estado",
  "txn.colActions": "Acciones",
  "txn.confirmDelete": "¿Seguro que quieres eliminar este movimiento?",
  "txn.deleteError": "Error al eliminar",
  "txn.editSaleUnavailable": "Función de edición de ventas no disponible",
  "txn.editPurchaseUnavailable": "Función de edición de compras no disponible",
  "txn.editOtherUnavailable": "Función de edición de otros no disponible",
  "txn.unknownType": "Tipo desconocido: {type}",

  // Product modal
  "modal.product.title": "Nuevo Producto",
  "modal.product.name": "Nombre del Producto",
  "modal.product.placeholder": "Mando LG",
  "modal.product.save": "Guardar Producto",
  "modal.product.noProject": "Error: No se ha seleccionado ningún proyecto.",
  "modal.product.createError": "Error al crear el producto",

  // Sale modal
  "modal.sale.title": "Nueva Venta",
  "modal.sale.channel": "Canal",
  "modal.sale.autofill": "Autocompleta precios unitarios",
  "modal.sale.save": "Guardar Venta",
  "modal.sale.selectChannel": "Seleccionar canal",
  "modal.sale.created": "Venta guardada correctamente",
  "modal.sale.updated": "Venta actualizada correctamente",
  "modal.sale.editTitle": "Editar Venta #{id}",
  "modal.sale.loadError": "Error al cargar la venta",

  // Purchase modal
  "modal.purchase.title": "Nueva Compra",
  "modal.purchase.status": "Estado",
  "modal.purchase.statusPending": "Pendiente",
  "modal.purchase.statusReceived": "Recibida",
  "modal.purchase.statusCancelled": "Cancelada",
  "modal.purchase.distribute": "Reparte según coste unitario",
  "modal.purchase.estimatedTotal": "Total Estimado",
  "modal.purchase.save": "Guardar Compra",
  "modal.purchase.created": "Compra guardada correctamente",
  "modal.purchase.updated": "Compra actualizada correctamente",
  "modal.purchase.editTitle": "Editar Compra #{id}",
  "modal.purchase.loadError": "Error al cargar la compra",
  "modal.purchase.addAtLeastOne": "Añade al menos un producto",

  // Other transaction modal
  "modal.other.title": "Otros Ingresos / Gastos",
  "modal.other.transType": "Tipo de Transacción",
  "modal.other.income": "Ingreso",
  "modal.other.expense": "Gasto",
  "modal.other.concept": "Concepto",
  "modal.other.conceptPlaceholder": "Selecciona o escribe...",
  "modal.other.amount": "Importe (€)",
  "modal.other.vatPct": "Porcentaje IVA (%)",
  "modal.other.optional": "(opcional)",
  "modal.other.description": "Descripción",
  "modal.other.descPlaceholder": "Detalles adicionales...",
  "modal.other.saved": "Guardado correctamente",
  "modal.other.editTitle": "Editar Transacción",
  "modal.other.loadError": "Error al cargar transacción",
  "modal.other.noProject": "Selecciona un proyecto",

  // History modals (stock / product)
  "modal.history.title": "Historial de Movimientos",
  "modal.history.productPrefix": "Producto:",
  "modal.history.manualAdjust": "Ajuste Manual",
  "modal.history.addManualAdjust": "Añadir Ajuste Manual",
  "modal.history.unitsPlusMinus": "Unidades (+/-)",
  "modal.history.unitsPlaceholderStock": "Ej: -5 o 10",
  "modal.history.unitsPlaceholderProduct": "Ej: 5 o -2",
  "modal.history.negativeHint": "Usa negativo para restar, positivo para sumar.",
  "modal.history.saveAdjust": "Guardar Ajuste",
  "modal.history.registerAdjust": "Registrar Ajuste",
  "modal.history.noMovements": "No hay movimientos registrados",
  "modal.history.noMovementsDot": "No hay movimientos registrados.",
  "modal.history.loadError": "Error al cargar historial",
  "modal.history.saveAdjustError": "Error al guardar el ajuste",
  "modal.history.loading": "Cargando historial...",
  "modal.history.colDate": "Fecha",
  "modal.history.colType": "Tipo",
  "modal.history.colUnits": "Unidades",
  "modal.history.colPrice": "Precio Unit.",
  "modal.history.colChannel": "Canal / Detalle",

  // Movement types
  "movementType.compra": "Compra",
  "movementType.venta": "Venta",
  "movementType.ajuste manual": "Ajuste Manual",
  "movementType.devolucion_vta": "Devolución Venta",
  "movementType.devolucion_com": "Devolución Compra",

  // Mock product names
  "product.mando_samsung_bn59": "Mando Samsung BN59",
  "product.mando_lg_akb75095308": "Mando LG AKB75095308",
  "product.mando_sony_rmt_tx300e": "Mando Sony RMT-TX300E",
  "product.mando_fire_tv_stick": "Mando Fire TV Stick",
  "product.mando_xiaomi_mi_box": "Mando Xiaomi Mi Box",

  // Mock project names
  "project.octopus_control": "Octopus Control",
  "project.demo_store": "Demo Store",

  // API
  "api.demoUnavailable": "No disponible en modo demo",
};

const en: Dict = {
  // Common
  "common.start": "Get started",
  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.edit": "Edit",
  "common.delete": "Delete",
  "common.loading": "Loading...",
  "common.loadingData": "Loading data...",
  "common.loadingMovements": "Loading movements...",
  "common.select": "Select",
  "common.products": "Products",
  "common.addProduct": "Add Product",
  "common.connectionError": "Connection error",
  "common.errorLoadingData": "Error loading data",
  "common.noProjectFirst": "Select a project first",
  "common.saveErrorPrefix": "Error saving:",
  "common.unknown": "Unknown",
  "common.totalAmountOptional": "Total Amount (Optional)",

  // Item rows
  "item.product": "Product",
  "item.units": "Qty",
  "item.price": "Price",
  "item.vat": "VAT %",
  "item.totalEur": "Total (€)",

  // Navigation
  "nav.home": "Home",
  "nav.stock": "Stock",
  "nav.transactions": "Transactions",
  "nav.history": "History",

  // Layout
  "layout.signOut": "Sign Out",
  "layout.dashboard": "Dashboard",

  // Page titles
  "title.dashboard": "OlivERP | Dashboard",
  "title.stock": "OlivERP | Stock",
  "title.transactions": "OlivERP | Transactions",
  "title.history": "OlivERP | History",
  "title.login": "OlivERP | Sign In",

  // Demo banner
  "demo.title": "Demo Mode",
  "demo.full":
    "You're viewing sample data. Configure the Supabase environment variables to connect to real data.",
  "demo.short": "Sample data.",

  // Finance labels
  "finance.income": "Income",
  "finance.expenses": "Expenses",
  "finance.balance": "Balance",
  "finance.vatBalance": "VAT Balance",
  "finance.urp": "URP",
  "finance.vatSupported": "Input VAT",
  "finance.vatCharged": "Output VAT",

  // Home / dashboard quick actions
  "index.newSale": "New Sale",
  "index.newSaleDesc": "Record stock outflow and generate income",
  "index.newPurchase": "New Purchase",
  "index.newPurchaseDesc": "Record incoming goods",
  "index.incomeExpense": "Income / Expense",
  "index.incomeExpenseDesc": "Record miscellaneous movements",

  // Login
  "login.welcome": "Welcome",
  "login.subtitle": "Sign in to access the ERP",
  "login.email": "Email",
  "login.password": "Password",
  "login.signIn": "Sign In",
  "login.forgot": "Forgot your password?",

  // Stock page + table
  "stock.title": "Inventory & Stock",
  "stock.subtitle": "Product management and inventory valuation",
  "stock.newProduct": "New Product",
  "stock.totalProducts": "Total Products",
  "stock.unitsInStock": "Units in Stock",
  "stock.totalValue": "Total Stock Value",
  "stock.totalSaleValue": "Sale",
  "stock.totalPurchaseValue": "Purchase",
  "stock.colProduct": "Product",
  "stock.colStock": "Stock",
  "stock.colValue": "Stock Value",
  "stock.colUnit": "Unit (B/S)",
  "stock.colProfitU": "Profit/U.",
  "stock.colProfit30": "Profit 30d",
  "stock.colStatus": "Status",
  "stock.noData": "No stock data for this project.",
  "stock.outOfStock": "Out of stock",
  "stock.noStatus": "No data",
  "stock.days": "{n} days",
  "stock.overYear": "+1 year",
  "stock.buyLabel": "B:",
  "stock.sellLabel": "S:",

  // Transactions page
  "transactions.title": "Transactions",
  "transactions.subtitle": "Daily finances, income and expenses",
  "transactions.viewDaily": "Daily mode",
  "transactions.daily": "Daily",
  "transactions.viewList": "Transactions mode",
  "transactions.list": "Transactions",

  // Transaction filters
  "filters.search": "Search concept or product...",
  "filters.type": "Type",
  "filters.allTypes": "All types",
  "filters.typeVenta": "Sales",
  "filters.typeCompra": "Purchases",
  "filters.typeIngreso": "Income",
  "filters.typeGasto": "Expenses",
  "filters.channel": "Channel",
  "filters.allChannels": "All channels",
  "filters.more": "Filters",
  "filters.dateRange": "Date range",
  "filters.dateFrom": "From",
  "filters.dateTo": "To",
  "filters.amountRange": "Amount range",
  "filters.amountMin": "Min",
  "filters.amountMax": "Max",
  "filters.clear": "Clear filters",
  "filters.apply": "Apply",
  "filters.noResults": "No transactions match the filters.",

  // History page
  "history.title": "Financial History",
  "history.subtitle": "View financial performance grouped by periods.",
  "history.selectProject": "Select a project to view its history.",
  "history.totalHistoric": "All Time",
  "history.viewMonths": "Months",
  "history.viewQuarters": "Quarters",
  "history.viewYears": "Years",
  "history.viewTotal": "Total",
  "history.period": "Period",

  // Dashboard stats
  "dashboard.balanceMonth": "{month} Balance",
  "dashboard.balanceQuarter": "{quarter} Balance",
  "dashboard.projection": "{month} Projection",
  "dashboard.estimatedIncome": "Estimated Income",
  "dashboard.day": "Day {current}/{total}",
  "dashboard.estimatedUrp": "Estimated URP",
  "dashboard.vatSupportedTip": "Input VAT (deductible on purchases)",
  "dashboard.vatChargedTip": "Output VAT (charged on sales)",
  "dashboard.quarterShort": "Q{n}",

  // Project selector
  "project.select": "Select Project",
  "project.mine": "My Projects",
  "project.none": "No projects",
  "project.new": "New Project",

  // Pagination
  "pagination.previous": "Previous",
  "pagination.next": "Next",

  // Revenue chart
  "chart.title": "Revenue Evolution",
  "chart.totalPeriod": "Period total:",
  "chart.days7": "7 days",
  "chart.days30": "30 days",
  "chart.days90": "90 days",

  // Transactions list
  "txn.noTransactions": "No transactions recorded for this project.",
  "txn.noDetails": "No detailed movements",
  "txn.colDate": "Date",
  "txn.colType": "Type",
  "txn.colConcept": "Concept / Products",
  "txn.colUnits": "Qty",
  "txn.colAmount": "Amount",
  "txn.colChannel": "Channel",
  "txn.colStatus": "Status",
  "txn.colActions": "Actions",
  "txn.confirmDelete": "Are you sure you want to delete this movement?",
  "txn.deleteError": "Error deleting",
  "txn.editSaleUnavailable": "Sale editing not available",
  "txn.editPurchaseUnavailable": "Purchase editing not available",
  "txn.editOtherUnavailable": "Editing not available",
  "txn.unknownType": "Unknown type: {type}",

  // Product modal
  "modal.product.title": "New Product",
  "modal.product.name": "Product Name",
  "modal.product.placeholder": "LG Remote",
  "modal.product.save": "Save Product",
  "modal.product.noProject": "Error: No project selected.",
  "modal.product.createError": "Error creating product",

  // Sale modal
  "modal.sale.title": "New Sale",
  "modal.sale.channel": "Channel",
  "modal.sale.autofill": "Auto-fills unit prices",
  "modal.sale.save": "Save Sale",
  "modal.sale.selectChannel": "Select channel",
  "modal.sale.created": "Sale saved successfully",
  "modal.sale.updated": "Sale updated successfully",
  "modal.sale.editTitle": "Edit Sale #{id}",
  "modal.sale.loadError": "Error loading sale",

  // Purchase modal
  "modal.purchase.title": "New Purchase",
  "modal.purchase.status": "Status",
  "modal.purchase.statusPending": "Pending",
  "modal.purchase.statusReceived": "Received",
  "modal.purchase.statusCancelled": "Cancelled",
  "modal.purchase.distribute": "Distributes by unit cost",
  "modal.purchase.estimatedTotal": "Estimated Total",
  "modal.purchase.save": "Save Purchase",
  "modal.purchase.created": "Purchase saved successfully",
  "modal.purchase.updated": "Purchase updated successfully",
  "modal.purchase.editTitle": "Edit Purchase #{id}",
  "modal.purchase.loadError": "Error loading purchase",
  "modal.purchase.addAtLeastOne": "Add at least one product",

  // Other transaction modal
  "modal.other.title": "Other Income / Expenses",
  "modal.other.transType": "Transaction Type",
  "modal.other.income": "Income",
  "modal.other.expense": "Expense",
  "modal.other.concept": "Concept",
  "modal.other.conceptPlaceholder": "Select or type...",
  "modal.other.amount": "Amount (€)",
  "modal.other.vatPct": "VAT Percentage (%)",
  "modal.other.optional": "(optional)",
  "modal.other.description": "Description",
  "modal.other.descPlaceholder": "Additional details...",
  "modal.other.saved": "Saved successfully",
  "modal.other.editTitle": "Edit Transaction",
  "modal.other.loadError": "Error loading transaction",
  "modal.other.noProject": "Select a project",

  // History modals
  "modal.history.title": "Movement History",
  "modal.history.productPrefix": "Product:",
  "modal.history.manualAdjust": "Manual Adjustment",
  "modal.history.addManualAdjust": "Add Manual Adjustment",
  "modal.history.unitsPlusMinus": "Units (+/-)",
  "modal.history.unitsPlaceholderStock": "e.g. -5 or 10",
  "modal.history.unitsPlaceholderProduct": "e.g. 5 or -2",
  "modal.history.negativeHint": "Use negative to subtract, positive to add.",
  "modal.history.saveAdjust": "Save Adjustment",
  "modal.history.registerAdjust": "Register Adjustment",
  "modal.history.noMovements": "No movements recorded",
  "modal.history.noMovementsDot": "No movements recorded.",
  "modal.history.loadError": "Error loading history",
  "modal.history.saveAdjustError": "Error saving adjustment",
  "modal.history.loading": "Loading history...",
  "modal.history.colDate": "Date",
  "modal.history.colType": "Type",
  "modal.history.colUnits": "Units",
  "modal.history.colPrice": "Unit Price",
  "modal.history.colChannel": "Channel / Detail",

  // Movement types
  "movementType.compra": "Purchase",
  "movementType.venta": "Sale",
  "movementType.ajuste manual": "Manual Adjustment",
  "movementType.devolucion_vta": "Sale Return",
  "movementType.devolucion_com": "Purchase Return",

  // Mock product names
  "product.mando_samsung_bn59": "Samsung BN59 Remote",
  "product.mando_lg_akb75095308": "LG AKB75095308 Remote",
  "product.mando_sony_rmt_tx300e": "Sony RMT-TX300E Remote",
  "product.mando_fire_tv_stick": "Fire TV Stick Remote",
  "product.mando_xiaomi_mi_box": "Xiaomi Mi Box Remote",

  // Mock project names
  "project.octopus_control": "Octopus Control",
  "project.demo_store": "Demo Store",

  // API
  "api.demoUnavailable": "Not available in demo mode",
};

export const ui: Record<Lang, Dict> = { es, en };
