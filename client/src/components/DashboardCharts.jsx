import Chart from 'react-apexcharts';
import PropTypes from 'prop-types';
import { memo, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Box,
  CheckCircle,
  TrendingUp,
  AlertCircle,
  MapPinOff,
  Layers,
  PieChart,
  LayoutGrid,
  MapPinned,
  Wrench,
  Recycle,
  Hammer,
  Lock
} from 'lucide-react';

const themeChartMap = {
  default: { primary: '#3b82f6', secondary: '#f59e0b', tertiary: '#8b5cf6' },
  ocean: {
    primary: '#2563eb',
    secondary: '#06b6d4',
    tertiary: '#6366f1',
    quaternary: '#7c3aed',
    quinary: '#38bdf8',
    gradientTargets: ['#60a5fa', '#22d3ee', '#818cf8', '#a78bfa', '#7dd3fc']
  },
  emerald: { primary: '#059669', secondary: '#10b981', tertiary: '#34d399' },
  sunset: { primary: '#ea580c', secondary: '#f97316', tertiary: '#fb923c' },
  midnight: { primary: '#38bdf8', secondary: '#6366f1', tertiary: '#22d3ee' },
  mono: { primary: '#374151', secondary: '#6b7280', tertiary: '#9ca3af' },
  glossy: { primary: '#4f46e5', secondary: '#6366f1', tertiary: '#818cf8' },
  astraLight: { primary: '#4f46e5', secondary: '#6366f1', tertiary: '#a5b4fc' },
  astraExecutive: { primary: '#4338ca', secondary: '#64748b', tertiary: '#94a3b8' }
};

const statColorMap = {
  blue: 'text-blue-500 bg-blue-50 group-hover:bg-blue-100',
  emerald: 'text-emerald-500 bg-emerald-50 group-hover:bg-emerald-100',
  amber: 'text-amber-500 bg-amber-50 group-hover:bg-amber-100',
  red: 'text-red-500 bg-red-50 group-hover:bg-red-100',
  gray: 'text-slate-500 bg-slate-100 group-hover:bg-slate-200',
  violet: 'text-violet-500 bg-violet-50 group-hover:bg-violet-100'
};

const barColorMap = {
  blue: 'bg-blue-500',
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
  gray: 'bg-slate-500',
  violet: 'bg-violet-500'
};

const OCEAN_3D_PIE_COLORS = ['#ef4444', '#facc15', '#3b82f6', '#22c55e', '#8b5cf6'];
const OCEAN_3D_PIE_GRADIENTS = ['#b91c1c', '#a16207', '#1d4ed8', '#15803d', '#6d28d9'];
const OCEAN_BAR_COLORS = ['#ef4444', '#facc15', '#6b7280', '#3b82f6', '#111827'];

/** Same order as Key metrics exclusive buckets — row counts & quantities stay aligned */
const FLEET_STATUS_LABELS = [
  'In Store',
  'In Use',
  'Reserved',
  'Faulty',
  'Missing',
  'Under Repair/Workshop',
  'Repaired',
  'Disposed'
];
const FLEET_STATUS_ROW_COLORS = ['#0ea5e9', '#22c55e', '#6366f1', '#ef4444', '#64748b', '#c2410c', '#10b981', '#94a3b8'];
const DEFAULT_ANALYTICS_SECTION_ORDER = [
  'key_metrics',
  'utilization_fleet',
  'locations_products_status',
  'maintenance_vendors',
  'growth'
];

const formatQtyLine = (n) => {
  const q = Number(n);
  if (!Number.isFinite(q) || q <= 0) return null;
  return `Quantity: ${q.toLocaleString()}`;
};

const StatCard = ({ title, value, icon: Icon, color, subText, quantityLine, onClick }) => {
  const iconClasses = statColorMap[color] || statColorMap.blue;
  const barClass = barColorMap[color] || barColorMap.blue;
  return (
    <div
      className="bg-app-card rounded-xl p-6 flex items-center justify-between relative overflow-hidden group hover:shadow-lg transition-all cursor-pointer"
      onClick={onClick}
    >
      <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${barClass}`}></div>
      <div className="min-w-0 pr-2">
        <h3 className="text-app-muted text-xs font-bold uppercase tracking-wider mb-1">{title}</h3>
        <div className="flex items-baseline flex-wrap gap-x-2 gap-y-0">
          <p className="text-3xl font-bold text-app-main tabular-nums">{value}</p>
          {subText && <span className="text-xs text-app-muted font-medium">{subText}</span>}
        </div>
        {quantityLine && (
          <p className="text-[10px] text-app-muted font-medium tabular-nums mt-1 tracking-wide">{quantityLine}</p>
        )}
      </div>
      <div className={`p-3 rounded-xl transition-colors shrink-0 ${iconClasses}`}>
        <Icon className="w-6 h-6" />
      </div>
    </div>
  );
};

StatCard.propTypes = {
  title: PropTypes.string.isRequired,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  icon: PropTypes.elementType.isRequired,
  color: PropTypes.string.isRequired,
  subText: PropTypes.string,
  quantityLine: PropTypes.string,
  onClick: PropTypes.func
};

const buildPieConfig = ({
  labels,
  values,
  colors,
  title,
  height = 280,
  vectorStyle = false,
  gradientTargets = [],
  tooltipItemLabel = 'assets'
}) => {
  const validValues = Array.isArray(values) ? values.map((n) => Number(n) || 0) : [];
  const total = validValues.reduce((sum, value) => sum + value, 0);
  const hasData = total > 0;
  const safeLabels = hasData ? labels : ['No Data'];
  const safeValues = hasData ? validValues : [1];
  const safeColors = hasData ? colors : ['#cbd5e1'];
  const safeGradientTargets = hasData && gradientTargets.length ? gradientTargets : safeColors;
  const baseStrokeColor = vectorStyle ? 'rgba(255,255,255,0.96)' : '#fff';
  const baseLegendColor = vectorStyle ? '#1f2937' : '#475569';
  return {
    title,
    height,
    type: 'donut',
    series: safeValues,
    options: {
      chart: {
        type: 'donut',
        fontFamily: 'inherit',
        animations: { enabled: false },
        dropShadow: vectorStyle
          ? { enabled: true, top: 8, left: 0, blur: 14, color: '#0f172a', opacity: 0.22 }
          : { enabled: false }
      },
      labels: safeLabels,
      colors: safeColors,
      stroke: { width: vectorStyle ? 2 : 1, colors: [baseStrokeColor] },
      legend: {
        show: true,
        position: 'bottom',
        markers: { width: 10, height: 10, radius: 12 },
        labels: { colors: baseLegendColor },
        formatter: (seriesName, opts) => {
          const value = opts.w.globals.series?.[opts.seriesIndex] || 0;
          const pct = total > 0 ? Math.round((value / total) * 100) : 0;
          return `${seriesName}: ${value} (${pct}%)`;
        }
      },
      dataLabels: {
        enabled: hasData,
        style: {
          fontWeight: 700,
          fontSize: vectorStyle ? '15px' : '13px',
          colors: vectorStyle ? ['#ffffff'] : undefined
        },
        dropShadow: {
          enabled: vectorStyle,
          blur: vectorStyle ? 3 : 0,
          opacity: vectorStyle ? 0.25 : 0
        },
        formatter: (val) => `${Math.round(val)}%`
      },
      fill: vectorStyle
        ? {
            type: 'gradient',
            gradient: {
              shade: 'dark',
              type: 'vertical',
              shadeIntensity: 0.62,
              gradientToColors: safeGradientTargets,
              inverseColors: false,
              opacityFrom: 1,
              opacityTo: 0.82,
              stops: [0, 55, 100]
            }
          }
        : { type: 'solid' },
      states: vectorStyle
        ? {
            hover: { filter: { type: 'lighten', value: 0.08 } },
            active: { filter: { type: 'none' } }
          }
        : undefined,
      tooltip: {
        y: {
          formatter: (value) => {
            const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
            return `${value} ${tooltipItemLabel} (${pct}%)`;
          }
        }
      },
      plotOptions: {
        pie: {
          customScale: vectorStyle ? 0.96 : 1,
          offsetY: 0,
          expandOnClick: false,
          donut: {
            size: vectorStyle ? '62%' : '68%',
            background: 'transparent',
            labels: {
              show: true,
              name: {
                show: vectorStyle,
                color: '#475569'
              },
              value: {
                show: vectorStyle,
                color: '#0f172a',
                fontWeight: 700,
                formatter: (value) => `${Number(value || 0)}`
              },
              total: {
                show: true,
                showAlways: vectorStyle,
                label: vectorStyle ? 'Total Assets' : hasData ? 'Total' : 'No Data',
                fontSize: vectorStyle ? '14px' : '16px',
                fontWeight: vectorStyle ? 600 : 600,
                color: vectorStyle ? '#0f172a' : '#334155',
                formatter: () => {
                  if (!hasData) return '-';
                  return `${total}`;
                }
              }
            }
          }
        }
      }
    }
  };
};

const SectionLabel = ({ icon: Icon, children }) => (
  <div className="flex items-center gap-2 px-0.5 pt-1">
    {Icon && <Icon className="h-3.5 w-3.5 text-app-accent shrink-0" aria-hidden />}
    <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-app-muted">{children}</h2>
    <div className="h-px flex-1 bg-app-card min-w-[2rem] opacity-80" aria-hidden />
  </div>
);

SectionLabel.propTypes = {
  icon: PropTypes.elementType,
  children: PropTypes.node
};

const DashboardCharts = ({
  stats,
  showMaintenanceVendorFeatures = false,
  selectedMaintenanceVendor = 'All',
  analyticsSectionOrder = DEFAULT_ANALYTICS_SECTION_ORDER,
  showInsightsStrip = true,
  chartWidgets = {}
}) => {
  const overview = stats?.overview;
  const growth = stats?.growth;
  const recurringFaultyByAbs = Array.isArray(stats?.recurringFaultyByAbs) ? stats.recurringFaultyByAbs : [];
  const locations = stats?.locations;
  const products = stats?.products;
  const maintenanceVendors = stats?.maintenanceVendors;
  const maintenanceVendorAssets = stats?.maintenanceVendorAssets;
  const safeOverview = overview || {
    total: 0,
    totalQuantity: 0,
    inUse: 0,
    inUseQuantity: 0,
    inStore: 0,
    inStoreQuantity: 0,
    missing: 0,
    missingQuantity: 0,
    disposed: 0,
    disposedQuantity: 0,
    reserved: 0,
    reservedQuantity: 0,
    repaired: 0,
    repairedQuantity: 0,
    underRepairWorkshop: 0,
    underRepairWorkshopQuantity: 0,
    faulty: 0,
    faultyQuantity: 0,
    pendingReturns: 0,
    pendingRequests: 0,
    assetTypes: 0
  };

  const selectedTheme = document?.documentElement?.dataset?.theme || 'default';
  const palette = themeChartMap[selectedTheme] || themeChartMap.default;
  const useVectorPieStyle = selectedTheme === 'ocean';
  const oceanPieColors = OCEAN_3D_PIE_COLORS;
  const oceanPieGradients = OCEAN_3D_PIE_GRADIENTS;
  const inUseCount = safeOverview.inUse || 0;
  const notInUseCount = Math.max((safeOverview.total || 0) - inUseCount, 0);
  const chartConfigs = useMemo(() => {
    const utilizationPie = buildPieConfig({
      labels: ['In Use', 'Not In Use'],
      values: [inUseCount, notInUseCount],
      colors: useVectorPieStyle ? oceanPieColors.slice(0, 2) : [palette.primary, palette.secondary],
      title: 'Asset Utilization',
      height: 300,
      vectorStyle: useVectorPieStyle,
      gradientTargets: useVectorPieStyle ? oceanPieGradients.slice(0, 2) : []
    });
    const fleetStatusRowsPie = buildPieConfig({
      labels: FLEET_STATUS_LABELS,
      values: [
        safeOverview.inStore || 0,
        safeOverview.inUse || 0,
        safeOverview.reserved || 0,
        safeOverview.faulty || 0,
        safeOverview.missing || 0,
        safeOverview.underRepairWorkshop || 0,
        safeOverview.repaired || 0,
        safeOverview.disposed || 0
      ],
      colors: useVectorPieStyle ? [...oceanPieColors, ...oceanPieColors.slice(0, 3)] : FLEET_STATUS_ROW_COLORS,
      title: 'Fleet by status (assets)',
      vectorStyle: useVectorPieStyle,
      gradientTargets: useVectorPieStyle ? [...oceanPieGradients, ...oceanPieGradients.slice(0, 3)] : []
    });
    const fleetStatusQtyPie = buildPieConfig({
      labels: FLEET_STATUS_LABELS,
      values: [
        safeOverview.inStoreQuantity || 0,
        safeOverview.inUseQuantity || 0,
        safeOverview.reservedQuantity || 0,
        safeOverview.faultyQuantity || 0,
        safeOverview.missingQuantity || 0,
        safeOverview.underRepairWorkshopQuantity || 0,
        safeOverview.repairedQuantity || 0,
        safeOverview.disposedQuantity || 0
      ],
      colors: useVectorPieStyle ? [...oceanPieColors, ...oceanPieColors.slice(0, 3)] : FLEET_STATUS_ROW_COLORS,
      title: 'Fleet by status (quantity)',
      vectorStyle: useVectorPieStyle,
      gradientTargets: useVectorPieStyle ? [...oceanPieGradients, ...oceanPieGradients.slice(0, 3)] : [],
      tooltipItemLabel: 'qty'
    });
    const lifecycleAssetsPie = buildPieConfig({
      labels: ['Repaired', 'Under Repair/Workshop', 'Disposed'],
      values: [safeOverview.repaired || 0, safeOverview.underRepairWorkshop || 0, safeOverview.disposed || 0],
      colors: useVectorPieStyle ? [oceanPieColors[3], oceanPieColors[1], oceanPieColors[0]] : ['#10b981', '#c2410c', '#64748b'],
      title: 'Lifecycle States (assets)',
      vectorStyle: useVectorPieStyle,
      gradientTargets: useVectorPieStyle ? [oceanPieGradients[3], oceanPieGradients[1], oceanPieGradients[0]] : []
    });
    const lifecycleQtyPie = buildPieConfig({
      labels: ['Repaired', 'Under Repair/Workshop', 'Disposed'],
      values: [
        safeOverview.repairedQuantity || 0,
        safeOverview.underRepairWorkshopQuantity || 0,
        safeOverview.disposedQuantity || 0
      ],
      colors: useVectorPieStyle ? [oceanPieColors[3], oceanPieColors[1], oceanPieColors[0]] : ['#10b981', '#c2410c', '#64748b'],
      title: 'Lifecycle States (quantity)',
      vectorStyle: useVectorPieStyle,
      gradientTargets: useVectorPieStyle ? [oceanPieGradients[3], oceanPieGradients[1], oceanPieGradients[0]] : [],
      tooltipItemLabel: 'qty'
    });
    const topLocations = (locations || []).slice(0, 5);
    const locationPie = buildPieConfig({
      labels: topLocations.map((item) => item.name || 'Unknown'),
      values: topLocations.map((item) => item.value || 0),
      colors: useVectorPieStyle ? oceanPieColors.slice(0, 5) : ['#0ea5e9', '#8b5cf6', '#14b8a6', '#f97316', '#a3e635'],
      title: 'Top Locations by Quantity',
      vectorStyle: useVectorPieStyle,
      gradientTargets: useVectorPieStyle ? oceanPieGradients.slice(0, 5) : [],
      tooltipItemLabel: 'qty'
    });
    const topProducts = (products || []).slice(0, 5);
    const productPie = buildPieConfig({
      labels: topProducts.map((item) => item.name || 'Unknown'),
      values: topProducts.map((item) => item.value || 0),
      colors: useVectorPieStyle ? oceanPieColors.slice(0, 5) : ['#6366f1', '#06b6d4', '#84cc16', '#fb7185', '#f59e0b'],
      title: 'Top Products by Quantity',
      vectorStyle: useVectorPieStyle,
      gradientTargets: useVectorPieStyle ? oceanPieGradients.slice(0, 5) : [],
      tooltipItemLabel: 'qty'
    });
    const siemensAssetRows = Number(maintenanceVendorAssets?.Siemens || 0);
    const g42AssetRows = Number(maintenanceVendorAssets?.G42 || 0);
    const otherVendorAssetRows = Number(maintenanceVendorAssets?.Other || 0);
    const totalFleetAssets = Number(safeOverview.total || 0);
    const maintenanceVendorPie = buildPieConfig({
      labels: ['Siemens', 'G42', 'Other'],
      values: [siemensAssetRows, g42AssetRows, otherVendorAssetRows],
      colors: useVectorPieStyle ? ['#3b82f6', '#f59e0b', '#64748b'] : ['#2563eb', '#f59e0b', '#94a3b8'],
      title: 'Maintenance Vendor Mix',
      vectorStyle: useVectorPieStyle,
      gradientTargets: useVectorPieStyle ? ['#1d4ed8', '#b45309', '#334155'] : [],
      tooltipItemLabel: 'assets'
    });
    const siemensVendorPie = buildPieConfig({
      labels: ['Siemens', 'Rest of fleet'],
      values: [siemensAssetRows, Math.max(0, totalFleetAssets - siemensAssetRows)],
      colors: useVectorPieStyle ? ['#3b82f6', '#94a3b8'] : ['#2563eb', '#cbd5e1'],
      title: 'Siemens',
      height: 280,
      vectorStyle: useVectorPieStyle,
      gradientTargets: useVectorPieStyle ? ['#1d4ed8', '#475569'] : [],
      tooltipItemLabel: 'assets'
    });
    const g42VendorPie = buildPieConfig({
      labels: ['G42', 'Rest of fleet'],
      values: [g42AssetRows, Math.max(0, totalFleetAssets - g42AssetRows)],
      colors: useVectorPieStyle ? ['#f59e0b', '#94a3b8'] : ['#ea580c', '#cbd5e1'],
      title: 'G42',
      height: 280,
      vectorStyle: useVectorPieStyle,
      gradientTargets: useVectorPieStyle ? ['#b45309', '#475569'] : [],
      tooltipItemLabel: 'assets'
    });
    const barOptions = {
      chart: {
        type: 'bar',
        toolbar: { show: false },
        fontFamily: 'inherit',
        animations: { enabled: false },
        dropShadow: useVectorPieStyle
          ? { enabled: true, top: 8, left: 0, blur: 12, color: '#334155', opacity: 0.24 }
          : { enabled: false }
      },
      plotOptions: {
        bar: {
          borderRadius: useVectorPieStyle ? 8 : 4,
          horizontal: false,
          columnWidth: useVectorPieStyle ? '52%' : '45%',
          distributed: useVectorPieStyle
        }
      },
      dataLabels: {
        enabled: true,
        offsetY: -8,
        style: { colors: [useVectorPieStyle ? '#374151' : '#fff'] },
        formatter: (val) => val || 0
      },
      colors: useVectorPieStyle ? OCEAN_BAR_COLORS : [palette.primary],
      xaxis: { categories: ['In Store', 'Faulty', 'Missing', 'Disposed'] },
      yaxis: {
        labels: {
          style: { colors: useVectorPieStyle ? '#6b7280' : '#64748b' }
        }
      },
      grid: {
        borderColor: useVectorPieStyle ? 'rgba(148,163,184,0.35)' : '#e2e8f0',
        xaxis: { lines: { show: false } },
        yaxis: { lines: { show: true } }
      },
      fill: useVectorPieStyle
        ? {
            type: 'gradient',
            gradient: {
              shade: 'dark',
              type: 'vertical',
              shadeIntensity: 0.8,
              opacityFrom: 1,
              opacityTo: 0.68,
              stops: [0, 55, 100]
            }
          }
        : { type: 'solid' }
    };
    const barSeries = [{
      name: 'Inventory Status',
      data: [safeOverview.inStore || 0, safeOverview.faulty || 0, safeOverview.missing || 0, safeOverview.disposed || 0]
    }];
    const lifecycleBarOptions = {
      ...barOptions,
      xaxis: { categories: ['Repaired', 'Under Repair/Workshop', 'Disposed'] },
      colors: useVectorPieStyle ? [OCEAN_BAR_COLORS[3], OCEAN_BAR_COLORS[1], OCEAN_BAR_COLORS[2]] : ['#10b981', '#c2410c', '#64748b']
    };
    const lifecycleBarSeries = [{
      name: 'Lifecycle Status',
      data: [safeOverview.repaired || 0, safeOverview.underRepairWorkshop || 0, safeOverview.disposed || 0]
    }];
    const growthOptions = {
      chart: { type: 'area', toolbar: { show: false }, fontFamily: 'inherit', animations: { enabled: false } },
      dataLabels: { enabled: false },
      stroke: { curve: 'smooth', width: 2 },
      xaxis: { categories: (growth || []).map((g) => g.name), axisBorder: { show: false }, axisTicks: { show: false } },
      yaxis: { show: false },
      grid: { show: false, padding: { left: 0, right: 0 } },
      colors: [palette.primary],
      fill: {
        type: 'gradient',
        gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0.1, stops: [0, 90, 100] }
      },
      tooltip: { y: { formatter: (val) => `${val} qty` } }
    };
    const growthSeries = [{ name: 'New Assets', data: (growth || []).map((g) => g.value) }];
    return { utilizationPie, fleetStatusRowsPie, fleetStatusQtyPie, lifecycleAssetsPie, lifecycleQtyPie, locationPie, productPie, maintenanceVendorPie, siemensVendorPie, g42VendorPie, barOptions, barSeries, lifecycleBarOptions, lifecycleBarSeries, growthOptions, growthSeries };
  }, [inUseCount, notInUseCount, useVectorPieStyle, oceanPieColors, oceanPieGradients, palette.primary, palette.secondary, locations, products, maintenanceVendorAssets, safeOverview.total, safeOverview.inStore, safeOverview.inUse, safeOverview.reserved, safeOverview.faulty, safeOverview.missing, safeOverview.disposed, safeOverview.repaired, safeOverview.underRepairWorkshop, safeOverview.inStoreQuantity, safeOverview.inUseQuantity, safeOverview.reservedQuantity, safeOverview.faultyQuantity, safeOverview.missingQuantity, safeOverview.disposedQuantity, safeOverview.repairedQuantity, safeOverview.underRepairWorkshopQuantity, growth]);
  const { utilizationPie, fleetStatusRowsPie, fleetStatusQtyPie, lifecycleAssetsPie, lifecycleQtyPie, locationPie, productPie, maintenanceVendorPie, siemensVendorPie, g42VendorPie, barOptions, barSeries, lifecycleBarOptions, lifecycleBarSeries, growthOptions, growthSeries } = chartConfigs;

  if (!stats) {
    return (
      <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-app-card bg-app-elevated p-10 text-center">
        <div className="h-10 w-10 animate-pulse rounded-full bg-app-card" />
        <p className="text-sm font-semibold text-app-main">Preparing charts…</p>
        <p className="text-xs text-app-muted max-w-xs">Analytics will appear when dashboard data is ready.</p>
      </div>
    );
  }

  const chartCardClass =
    'relative overflow-hidden bg-app-card p-6 rounded-2xl border border-app-card shadow-sm hover:shadow-md transition-all duration-300';
  const chartCardAccent = 'absolute left-0 top-0 h-full w-1 bg-[rgb(var(--accent-color))] opacity-80 rounded-l-2xl';
  const chartTitleClass = 'text-app-main font-bold mb-1 flex items-center gap-2 pr-2';
  const chartSubtitleClass = 'text-xs text-app-muted mb-4 max-w-prose';
  const utilizationPct = safeOverview.total ? Math.round((safeOverview.inUse / safeOverview.total) * 100) : 0;
  const reservePct = safeOverview.total ? Math.round((safeOverview.reserved / safeOverview.total) * 100) : 0;
  const lifecycleQtyTotal =
    Number(safeOverview.repairedQuantity || 0) +
    Number(safeOverview.underRepairWorkshopQuantity || 0) +
    Number(safeOverview.disposedQuantity || 0);
  const siemensQty = Number(maintenanceVendors?.Siemens || 0);
  const g42Qty = Number(maintenanceVendors?.G42 || 0);
  const otherVendorQty = Number(maintenanceVendors?.Other || 0);
  const siemensAssets = Number(maintenanceVendorAssets?.Siemens || 0);
  const g42Assets = Number(maintenanceVendorAssets?.G42 || 0);
  const otherVendorAssets = Number(maintenanceVendorAssets?.Other || 0);
  const showWidget = (key) => chartWidgets?.[key] !== false;

  const navigateToAssets = (status) => {
    const params = new URLSearchParams();
    const exclusiveBuckets = new Set([
      'In Store',
      'In Use',
      'Faulty',
      'Missing',
      'Disposed',
      'Reserved',
      'Repaired',
      'Under Repair/Workshop'
    ]);
    if (status === '__TOTAL__') {
      params.set('disposed', 'all');
    } else if (exclusiveBuckets.has(status)) {
      params.set('derived_status', status);
    } else if (status) {
      params.set('status', status);
    }
    if (selectedMaintenanceVendor && selectedMaintenanceVendor !== 'All') {
      params.set('maintenance_vendor', selectedMaintenanceVendor);
    }
    const query = params.toString();
    window.open(`/assets${query ? `?${query}` : ''}`, '_blank', 'noopener,noreferrer');
  };

  const analyticsSectionsById = {
    key_metrics: (
      <section className="space-y-4" aria-label="Key metrics">
        <SectionLabel icon={LayoutGrid}>Key metrics</SectionLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 md:gap-5">
        <StatCard title="Total Assets" value={safeOverview.total} icon={Box} color="blue" subText="In Inventory" quantityLine={formatQtyLine(safeOverview.totalQuantity)} onClick={() => navigateToAssets('__TOTAL__')} />
        <StatCard title="In Use" value={safeOverview.inUse} icon={CheckCircle} color="emerald" subText={`${safeOverview.total ? Math.round((safeOverview.inUse / safeOverview.total) * 100) : 0}% Utilization`} quantityLine={formatQtyLine(safeOverview.inUseQuantity)} onClick={() => navigateToAssets('In Use')} />
        <StatCard title="In Store" value={safeOverview.inStore} icon={Box} color="amber" subText="Available inventory" quantityLine={formatQtyLine(safeOverview.inStoreQuantity)} onClick={() => navigateToAssets('In Store')} />
        <StatCard title="Faulty" value={safeOverview.faulty} icon={AlertCircle} color="red" subText="Not issuable" quantityLine={formatQtyLine(safeOverview.faultyQuantity)} onClick={() => navigateToAssets('Faulty')} />
        <StatCard title="Missing" value={safeOverview.missing} icon={MapPinOff} color="gray" subText="Needs investigation" quantityLine={formatQtyLine(safeOverview.missingQuantity)} onClick={() => navigateToAssets('Missing')} />
        <StatCard title="Disposed" value={safeOverview.disposed} icon={Recycle} color="gray" subText="Retired assets" quantityLine={formatQtyLine(safeOverview.disposedQuantity)} onClick={() => navigateToAssets('Disposed')} />
        <StatCard title="Repaired" value={safeOverview.repaired || 0} icon={CheckCircle} color="emerald" subText="Condition based" quantityLine={formatQtyLine(safeOverview.repairedQuantity)} onClick={() => navigateToAssets('Repaired')} />
        <StatCard title="Under Repair/Workshop" value={safeOverview.underRepairWorkshop || 0} icon={Hammer} color="amber" subText="Currently in workshop" quantityLine={formatQtyLine(safeOverview.underRepairWorkshopQuantity)} onClick={() => navigateToAssets('Under Repair/Workshop')} />
        <StatCard title="Reserved Assets" value={safeOverview.reserved || 0} icon={Lock} color="blue" subText="Held / not issuable" quantityLine={formatQtyLine(safeOverview.reservedQuantity)} onClick={() => navigateToAssets('Reserved')} />
        <StatCard title="Asset Types" value={safeOverview.assetTypes || 0} icon={Layers} color="violet" subText="Unique products" onClick={() => window.open('/products', '_blank', 'noopener,noreferrer')} />
        </div>
      </section>
    ),
    utilization_fleet: (
      <section className="space-y-4" aria-label="Utilization and fleet status">
        <SectionLabel icon={PieChart}>Utilization &amp; fleet status</SectionLabel>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-5">
        {showWidget('utilizationPie') && <div className={chartCardClass}>
          <span className={chartCardAccent} aria-hidden />
          <h3 className={`${chartTitleClass} mt-0.5`}><PieChart size={18} className="text-app-accent shrink-0" />{utilizationPie.title}</h3>
          <p className={chartSubtitleClass}>Same row counts as Key metrics (ACTIVE): In Use vs all other active assets (excluding Disposed).</p>
          <Chart options={utilizationPie.options} series={utilizationPie.series} type={utilizationPie.type} height={utilizationPie.height} />
        </div>}
        {showWidget('fleetStatusAssetsPie') && <div className={chartCardClass}>
          <span className={chartCardAccent} aria-hidden />
          <h3 className={`${chartTitleClass} mt-0.5`}><PieChart size={18} className="text-app-accent shrink-0" />{fleetStatusRowsPie.title}</h3>
          <p className={chartSubtitleClass}>Matches Key metrics by status buckets (includes Disposed as its own slice).</p>
          <Chart options={fleetStatusRowsPie.options} series={fleetStatusRowsPie.series} type={fleetStatusRowsPie.type} height={fleetStatusRowsPie.height} />
        </div>}
        {showWidget('fleetStatusQuantityPie') && <div className={chartCardClass}>
          <span className={chartCardAccent} aria-hidden />
          <h3 className={`${chartTitleClass} mt-0.5`}><PieChart size={18} className="text-app-accent shrink-0" />{fleetStatusQtyPie.title}</h3>
          <p className={chartSubtitleClass}>Matches Key metrics Quantity lines by status buckets (includes Disposed).</p>
          <Chart options={fleetStatusQtyPie.options} series={fleetStatusQtyPie.series} type={fleetStatusQtyPie.type} height={fleetStatusQtyPie.height} />
        </div>}
        {showWidget('lifecycleAssetsPie') && <div className={chartCardClass}>
          <span className={chartCardAccent} aria-hidden />
          <h3 className={`${chartTitleClass} mt-0.5`}><PieChart size={18} className="text-app-accent shrink-0" />{lifecycleAssetsPie.title}</h3>
          <p className={chartSubtitleClass}>Disposed, repaired and workshop split (asset rows).</p>
          <Chart options={lifecycleAssetsPie.options} series={lifecycleAssetsPie.series} type={lifecycleAssetsPie.type} height={lifecycleAssetsPie.height} />
        </div>}
        {showWidget('lifecycleQuantityPie') && <div className={chartCardClass}>
          <span className={chartCardAccent} aria-hidden />
          <h3 className={`${chartTitleClass} mt-0.5`}><PieChart size={18} className="text-app-accent shrink-0" />{lifecycleQtyPie.title}</h3>
          <p className={chartSubtitleClass}>Disposed, repaired and workshop split (quantity).</p>
          <Chart options={lifecycleQtyPie.options} series={lifecycleQtyPie.series} type={lifecycleQtyPie.type} height={lifecycleQtyPie.height} />
        </div>}
        </div>
        {showInsightsStrip && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-xl border border-app-card bg-app-card p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-app-muted">Utilization</p>
              <p className="mt-1 text-2xl font-bold text-app-main tabular-nums">{utilizationPct}%</p>
              <p className="text-xs text-app-muted mt-1">{safeOverview.inUse} in use out of {safeOverview.total} active assets</p>
            </div>
            <div className="rounded-xl border border-app-card bg-app-card p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-app-muted">Reserved Pressure</p>
              <p className="mt-1 text-2xl font-bold text-app-main tabular-nums">{reservePct}%</p>
              <p className="text-xs text-app-muted mt-1">{safeOverview.reserved} reserved assets ({safeOverview.reservedQuantity} qty)</p>
            </div>
            <div className="rounded-xl border border-app-card bg-app-card p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-app-muted">Lifecycle Volume</p>
              <p className="mt-1 text-2xl font-bold text-app-main tabular-nums">{lifecycleQtyTotal}</p>
              <p className="text-xs text-app-muted mt-1">Repaired + workshop + disposed quantity</p>
            </div>
          </div>
        )}
      </section>
    ),
    locations_products_status: (
      <section className="space-y-4" aria-label="Locations products and status">
        <SectionLabel icon={MapPinned}>Locations, products &amp; status</SectionLabel>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-5">
        {showWidget('topLocationsPie') && <div className={chartCardClass}>
          <span className={chartCardAccent} aria-hidden />
          <h3 className={`${chartTitleClass} mt-0.5`}><PieChart size={18} className="text-app-accent shrink-0" />{locationPie.title}</h3>
          <p className={chartSubtitleClass}>Where the largest quantities live.</p>
          <Chart options={locationPie.options} series={locationPie.series} type={locationPie.type} height={locationPie.height} />
        </div>}
        {showWidget('topProductsPie') && <div className={chartCardClass}>
          <span className={chartCardAccent} aria-hidden />
          <h3 className={`${chartTitleClass} mt-0.5`}><PieChart size={18} className="text-app-accent shrink-0" />{productPie.title}</h3>
          <p className={chartSubtitleClass}>Top product lines by quantity.</p>
          <Chart options={productPie.options} series={productPie.series} type={productPie.type} height={productPie.height} />
        </div>}
        {showWidget('inventoryExceptionsBar') && <div className={chartCardClass}>
          <span className={chartCardAccent} aria-hidden />
          <h3 className={`${chartTitleClass} mt-0.5`}>In Store vs Faulty vs Missing vs Disposed</h3>
          <p className={chartSubtitleClass}>Inventory exceptions at a glance.</p>
          <Chart options={barOptions} series={barSeries} type="bar" height={300} />
        </div>}
        {showWidget('lifecycleBar') && <div className={chartCardClass}>
          <span className={chartCardAccent} aria-hidden />
          <h3 className={`${chartTitleClass} mt-0.5`}>Repaired vs Under Repair/Workshop vs Disposed</h3>
          <p className={chartSubtitleClass}>Lifecycle movement and retirement snapshot.</p>
          <Chart options={lifecycleBarOptions} series={lifecycleBarSeries} type="bar" height={300} />
        </div>}
        </div>
      </section>
    ),
    maintenance_vendors: showMaintenanceVendorFeatures ? (
      <section className="space-y-4" aria-label="Maintenance vendors">
        <SectionLabel icon={Wrench}>Maintenance vendors</SectionLabel>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-5">
        {showWidget('siemensPie') && <div className={chartCardClass}>
          <span className={chartCardAccent} aria-hidden />
          <h3 className={`${chartTitleClass} mt-0.5`}>
            <PieChart size={18} className="text-app-accent shrink-0" />
            {siemensVendorPie.title}
          </h3>
          <div className="mb-3">
            <p className="text-2xl font-bold text-app-main tabular-nums leading-tight">{siemensAssets}</p>
            {formatQtyLine(siemensQty) && (
              <p className="text-[10px] text-app-muted font-medium tabular-nums mt-1 tracking-wide">{formatQtyLine(siemensQty)}</p>
            )}
          </div>
          <p className="text-xs text-app-muted mb-4">Siemens-maintained asset rows vs the rest of the active fleet (same scope as Key metrics Total Assets).</p>
          <Chart options={siemensVendorPie.options} series={siemensVendorPie.series} type={siemensVendorPie.type} height={siemensVendorPie.height} />
        </div>}
        {showWidget('g42Pie') && <div className={chartCardClass}>
          <span className={chartCardAccent} aria-hidden />
          <h3 className={`${chartTitleClass} mt-0.5`}>
            <PieChart size={18} className="text-app-accent shrink-0" />
            {g42VendorPie.title}
          </h3>
          <div className="mb-3">
            <p className="text-2xl font-bold text-app-main tabular-nums leading-tight">{g42Assets}</p>
            {formatQtyLine(g42Qty) && (
              <p className="text-[10px] text-app-muted font-medium tabular-nums mt-1 tracking-wide">{formatQtyLine(g42Qty)}</p>
            )}
          </div>
          <p className="text-xs text-app-muted mb-4">G42-maintained asset rows vs the rest of the active fleet (same scope as Key metrics Total Assets).</p>
          <Chart options={g42VendorPie.options} series={g42VendorPie.series} type={g42VendorPie.type} height={g42VendorPie.height} />
        </div>}
        {showWidget('maintenanceMixPie') && <div className={chartCardClass}>
          <span className={chartCardAccent} aria-hidden />
          <h3 className={`${chartTitleClass} mt-0.5`}>
            <PieChart size={18} className="text-app-accent shrink-0" />
            {maintenanceVendorPie.title}
          </h3>
          <div className="mb-2">
            <p className="text-2xl font-bold text-app-main tabular-nums leading-tight">
              {siemensAssets + g42Assets + otherVendorAssets}
            </p>
            {formatQtyLine(siemensQty + g42Qty + otherVendorQty) && (
              <p className="text-[10px] text-app-muted font-medium tabular-nums mt-1 tracking-wide">
                {formatQtyLine(siemensQty + g42Qty + otherVendorQty)}
              </p>
            )}
          </div>
          <p className="text-xs text-app-muted mb-3">Compare vendors (active asset rows) and jump to filtered assets.</p>
          <div className="mb-4 flex flex-wrap gap-2">
            {['Siemens', 'G42'].map((vendor) => (
              <button
                key={vendor}
                type="button"
                onClick={() => {
                  const params = new URLSearchParams();
                  params.set('maintenance_vendor', vendor);
                  window.open(`/assets?${params.toString()}`, '_blank', 'noopener,noreferrer');
                }}
                className="inline-flex items-center rounded-full border border-app-card bg-app-elevated px-3 py-1.5 text-xs font-semibold text-app-main hover:bg-app-card transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--accent-color))]"
              >
                {vendor}
              </button>
            ))}
          </div>
          <Chart options={maintenanceVendorPie.options} series={maintenanceVendorPie.series} type={maintenanceVendorPie.type} height={maintenanceVendorPie.height} />
        </div>}
        </div>
      </section>
    ) : null,
    growth:
      showWidget('growthArea') && ((growth || []).length > 0 || recurringFaultyByAbs.length > 0) ? (
        <section className="space-y-4" aria-label="Growth and acquisition">
          <SectionLabel icon={TrendingUp}>Growth</SectionLabel>
          {recurringFaultyByAbs.length > 0 ? (
            <div className={chartCardClass}>
              <span className={chartCardAccent} aria-hidden />
              <h3 className={`${chartTitleClass} mt-0.5`}>
                <AlertCircle className="w-5 h-5 text-rose-500 shrink-0" />
                Recurring faults by ABS code
              </h3>
              <p className={chartSubtitleClass}>
                Same permanent <strong>ABS</strong> with two or more faulty-related history events in the last ~24 months (hardware may have been swapped — serial/MAC can change while ABS stays the same).
              </p>
              <div className="overflow-x-auto rounded-xl border border-app-card bg-app-elevated/20">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-app-card bg-app-elevated/40 text-app-muted text-xs uppercase tracking-wide">
                    <tr>
                      <th className="px-3 py-2 font-semibold">ABS</th>
                      <th className="px-3 py-2 font-semibold tabular-nums">Faulty events</th>
                      <th className="px-3 py-2 font-semibold tabular-nums">Asset rows</th>
                      <th className="px-3 py-2 font-semibold">Last event</th>
                      <th className="px-3 py-2 font-semibold">Latest row (hint)</th>
                      <th className="px-3 py-2 font-semibold w-28"> </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-app-card text-app-main">
                    {recurringFaultyByAbs.map((row) => {
                      const abs = String(row.abs_code || '').trim();
                      const qParams = new URLSearchParams();
                      if (abs) qParams.set('q', abs);
                      if (selectedMaintenanceVendor && selectedMaintenanceVendor !== 'All') {
                        qParams.set('maintenance_vendor', selectedMaintenanceVendor);
                      }
                      const toAssets = `/assets${qParams.toString() ? `?${qParams.toString()}` : ''}`;
                      const hint = [row.sampleName, row.sampleModel, row.sampleSerial, row.sampleUniqueId]
                        .filter(Boolean)
                        .slice(0, 3)
                        .join(' · ');
                      const last = row.lastFaultAt ? new Date(row.lastFaultAt).toLocaleString() : '—';
                      return (
                        <tr key={`${abs}-${String(row.lastFaultAt || '')}`} className="hover:bg-app-elevated/30">
                          <td className="px-3 py-2 font-mono text-xs font-semibold">{abs || '—'}</td>
                          <td className="px-3 py-2 tabular-nums">{Number(row.faultyEventCount) || 0}</td>
                          <td className="px-3 py-2 tabular-nums">{Number(row.distinctAssetCount) || 0}</td>
                          <td className="px-3 py-2 text-xs text-app-muted whitespace-nowrap">{last}</td>
                          <td className="px-3 py-2 text-xs text-app-muted max-w-[14rem] truncate" title={hint}>
                            {hint || '—'}
                          </td>
                          <td className="px-3 py-2">
                            <Link
                              to={toAssets}
                              className="inline-flex text-xs font-bold text-app-accent hover:underline"
                            >
                              View assets
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
          {(growth || []).length > 0 ? (
            <div className={chartCardClass}>
              <span className={chartCardAccent} aria-hidden />
              <h3 className={`${chartTitleClass} mt-0.5`}>
                <TrendingUp className="w-5 h-5 text-app-accent shrink-0" />
                Asset Acquisition Trend (Last 6 Months)
              </h3>
              <p className={chartSubtitleClass}>New assets registered over recent months.</p>
              <div className="h-[300px] w-full">
                <Chart options={growthOptions} series={growthSeries} type="area" height="100%" />
              </div>
            </div>
          ) : null}
        </section>
      ) : null
  };

  const orderedSectionIds = Array.isArray(analyticsSectionOrder) && analyticsSectionOrder.length > 0
    ? analyticsSectionOrder
    : DEFAULT_ANALYTICS_SECTION_ORDER;

  const orderedSections = orderedSectionIds
    .map((id) => analyticsSectionsById[id])
    .filter(Boolean);

  return (
    <div className="space-y-8">
      {orderedSections}
    </div>
  );
};

DashboardCharts.propTypes = {
  stats: PropTypes.object,
  showMaintenanceVendorFeatures: PropTypes.bool,
  selectedMaintenanceVendor: PropTypes.string,
  analyticsSectionOrder: PropTypes.arrayOf(PropTypes.string),
  showInsightsStrip: PropTypes.bool,
  chartWidgets: PropTypes.object
};

export default memo(DashboardCharts);
