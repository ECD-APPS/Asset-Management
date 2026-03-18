import Chart from 'react-apexcharts';
import PropTypes from 'prop-types';
import { useMemo } from 'react';
import {
  Box,
  CheckCircle,
  TrendingUp,
  AlertCircle,
  MapPinOff,
  Layers,
  PieChart
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

const StatCard = ({ title, value, icon: Icon, color, subText, onClick }) => {
  const iconClasses = statColorMap[color] || statColorMap.blue;
  const barClass = barColorMap[color] || barColorMap.blue;
  return (
    <div
      className="bg-app-card rounded-xl p-6 flex items-center justify-between relative overflow-hidden group hover:shadow-lg transition-all cursor-pointer"
      onClick={onClick}
    >
      <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${barClass}`}></div>
      <div>
        <h3 className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">{title}</h3>
        <div className="flex items-baseline space-x-2">
          <p className="text-3xl font-bold text-app-main">{value}</p>
          {subText && <span className="text-xs text-slate-400">{subText}</span>}
        </div>
      </div>
      <div className={`p-3 rounded-xl transition-colors ${iconClasses}`}>
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
  onClick: PropTypes.func
};

const buildPieConfig = ({
  labels,
  values,
  colors,
  title,
  height = 280,
  vectorStyle = false,
  gradientTargets = []
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
            return `${value} assets (${pct}%)`;
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

const DashboardCharts = ({ stats, showMaintenanceVendorFeatures = false }) => {
  if (!stats) return <div className="p-8 text-center text-gray-500">Loading dashboard data...</div>;

  const { overview, growth, conditions, usageBreakdown, locations, products, maintenanceVendors } = stats;
  const safeOverview = overview || {
    total: 0,
    inUse: 0,
    inStore: 0,
    missing: 0,
    faulty: 0,
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
    const conditionPie = buildPieConfig({
      labels: ['New', 'Used', 'Faulty', 'Repaired'],
      values: [conditions?.New || 0, conditions?.Used || 0, conditions?.Faulty || 0, conditions?.Repaired || 0],
      colors: useVectorPieStyle ? oceanPieColors.slice(0, 4) : ['#22c55e', '#3b82f6', '#ef4444', '#f59e0b'],
      title: 'Condition Mix',
      vectorStyle: useVectorPieStyle,
      gradientTargets: useVectorPieStyle ? oceanPieGradients.slice(0, 4) : []
    });
    const usagePie = buildPieConfig({
      labels: ['Installed', 'Used', 'Faulty', 'Other'],
      values: [usageBreakdown?.installed || 0, usageBreakdown?.used || 0, usageBreakdown?.faulty || 0, usageBreakdown?.other || 0],
      colors: useVectorPieStyle ? oceanPieColors.slice(0, 4) : ['#2563eb', '#16a34a', '#dc2626', '#64748b'],
      title: 'Usage Classification',
      vectorStyle: useVectorPieStyle,
      gradientTargets: useVectorPieStyle ? oceanPieGradients.slice(0, 4) : []
    });
    const topLocations = (locations || []).slice(0, 5);
    const locationPie = buildPieConfig({
      labels: topLocations.map((item) => item.name || 'Unknown'),
      values: topLocations.map((item) => item.value || 0),
      colors: useVectorPieStyle ? oceanPieColors.slice(0, 5) : ['#0ea5e9', '#8b5cf6', '#14b8a6', '#f97316', '#a3e635'],
      title: 'Top Locations by Quantity',
      vectorStyle: useVectorPieStyle,
      gradientTargets: useVectorPieStyle ? oceanPieGradients.slice(0, 5) : []
    });
    const topProducts = (products || []).slice(0, 5);
    const productPie = buildPieConfig({
      labels: topProducts.map((item) => item.name || 'Unknown'),
      values: topProducts.map((item) => item.value || 0),
      colors: useVectorPieStyle ? oceanPieColors.slice(0, 5) : ['#6366f1', '#06b6d4', '#84cc16', '#fb7185', '#f59e0b'],
      title: 'Top Products by Quantity',
      vectorStyle: useVectorPieStyle,
      gradientTargets: useVectorPieStyle ? oceanPieGradients.slice(0, 5) : []
    });
    const maintenanceVendorPie = buildPieConfig({
      labels: ['Siemens', 'G42', 'Other'],
      values: [maintenanceVendors?.Siemens || 0, maintenanceVendors?.G42 || 0, maintenanceVendors?.Other || 0],
      colors: useVectorPieStyle ? ['#3b82f6', '#f59e0b', '#64748b'] : ['#2563eb', '#f59e0b', '#94a3b8'],
      title: 'Maintenance Vendor Mix',
      vectorStyle: useVectorPieStyle,
      gradientTargets: useVectorPieStyle ? ['#1d4ed8', '#b45309', '#334155'] : []
    });
    const barOptions = {
      chart: {
        type: 'bar',
        toolbar: { show: false },
        fontFamily: 'inherit',
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
      xaxis: { categories: ['In Store', 'Faulty', 'Missing'] },
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
      data: [safeOverview.inStore || 0, safeOverview.faulty || 0, safeOverview.missing || 0]
    }];
    const growthOptions = {
      chart: { type: 'area', toolbar: { show: false }, fontFamily: 'inherit', animations: { enabled: true } },
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
      tooltip: { y: { formatter: (val) => `${val} Assets` } }
    };
    const growthSeries = [{ name: 'New Assets', data: (growth || []).map((g) => g.value) }];
    return { utilizationPie, conditionPie, usagePie, locationPie, productPie, maintenanceVendorPie, barOptions, barSeries, growthOptions, growthSeries };
  }, [inUseCount, notInUseCount, useVectorPieStyle, oceanPieColors, oceanPieGradients, palette.primary, conditions, usageBreakdown, locations, products, maintenanceVendors, safeOverview.inStore, safeOverview.faulty, safeOverview.missing, growth]);
  const { utilizationPie, conditionPie, usagePie, locationPie, productPie, maintenanceVendorPie, barOptions, barSeries, growthOptions, growthSeries } = chartConfigs;
  const chartCardClass = 'bg-app-card p-6 rounded-2xl border border-app-card shadow-sm hover:shadow-md transition-all duration-300';

  const navigateToAssets = (status) => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    const query = params.toString();
    window.open(`/assets${query ? `?${query}` : ''}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-6">
        <StatCard title="Total Assets" value={safeOverview.total} icon={Box} color="blue" subText="In Inventory" onClick={() => navigateToAssets('')} />
        <StatCard title="In Use" value={safeOverview.inUse} icon={CheckCircle} color="emerald" subText={`${safeOverview.total ? Math.round((safeOverview.inUse / safeOverview.total) * 100) : 0}% Utilization`} onClick={() => navigateToAssets('In Use')} />
        <StatCard title="In Store" value={safeOverview.inStore} icon={Box} color="amber" subText="Available inventory" onClick={() => navigateToAssets('In Store')} />
        <StatCard title="Faulty" value={safeOverview.faulty} icon={AlertCircle} color="red" subText="Not issuable" onClick={() => navigateToAssets('Faulty')} />
        <StatCard title="Missing" value={safeOverview.missing} icon={MapPinOff} color="gray" subText="Needs investigation" onClick={() => navigateToAssets('Missing')} />
        <StatCard title="Asset Types" value={safeOverview.assetTypes || 0} icon={Layers} color="violet" subText="Unique products" onClick={() => window.open('/products', '_blank', 'noopener,noreferrer')} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className={`${chartCardClass} xl:col-span-4`}>
          <h3 className="text-app-main font-bold mb-4 flex items-center gap-2"><PieChart size={18} className="text-app-accent" />{utilizationPie.title}</h3>
          <Chart options={utilizationPie.options} series={utilizationPie.series} type={utilizationPie.type} height={utilizationPie.height} />
        </div>
        <div className={`${chartCardClass} xl:col-span-4`}>
          <h3 className="text-app-main font-bold mb-4 flex items-center gap-2"><PieChart size={18} className="text-app-accent" />{conditionPie.title}</h3>
          <Chart options={conditionPie.options} series={conditionPie.series} type={conditionPie.type} height={conditionPie.height} />
        </div>
        <div className={`${chartCardClass} xl:col-span-4`}>
          <h3 className="text-app-main font-bold mb-4 flex items-center gap-2"><PieChart size={18} className="text-app-accent" />{usagePie.title}</h3>
          <Chart options={usagePie.options} series={usagePie.series} type={usagePie.type} height={usagePie.height} />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className={`${chartCardClass} xl:col-span-4`}>
          <h3 className="text-app-main font-bold mb-4 flex items-center gap-2"><PieChart size={18} className="text-app-accent" />{locationPie.title}</h3>
          <Chart options={locationPie.options} series={locationPie.series} type={locationPie.type} height={locationPie.height} />
        </div>
        <div className={`${chartCardClass} xl:col-span-4`}>
          <h3 className="text-app-main font-bold mb-4 flex items-center gap-2"><PieChart size={18} className="text-app-accent" />{productPie.title}</h3>
          <Chart options={productPie.options} series={productPie.series} type={productPie.type} height={productPie.height} />
        </div>
        <div className={`${chartCardClass} xl:col-span-4`}>
          <h3 className="text-app-main font-bold mb-4">In Store vs Faulty vs Missing</h3>
          <Chart options={barOptions} series={barSeries} type="bar" height={300} />
        </div>
      </div>

      {showMaintenanceVendorFeatures && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          <div className={`${chartCardClass} xl:col-span-4`}>
            <h3 className="text-app-main font-bold mb-1 flex items-center gap-2"><PieChart size={18} className="text-app-accent" />{maintenanceVendorPie.title}</h3>
            <p className="text-xs text-app-muted mb-3">Quick filter by vendor</p>
            <div className="mb-3 flex flex-wrap gap-2">
              {['Siemens', 'G42'].map((vendor) => (
                <button
                  key={vendor}
                  type="button"
                  onClick={() => {
                    const params = new URLSearchParams();
                    params.set('maintenance_vendor', vendor);
                    window.open(`/assets?${params.toString()}`, '_blank', 'noopener,noreferrer');
                  }}
                  className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  {vendor}
                </button>
              ))}
            </div>
            <Chart options={maintenanceVendorPie.options} series={maintenanceVendorPie.series} type={maintenanceVendorPie.type} height={maintenanceVendorPie.height} />
          </div>
        </div>
      )}

      {(growth || []).length > 0 && (
        <div className={chartCardClass}>
          <h3 className="text-app-main font-bold mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-app-accent" />
            Asset Acquisition Trend (Last 6 Months)
          </h3>
          <div className="h-[300px] w-full">
            <Chart options={growthOptions} series={growthSeries} type="area" height="100%" />
          </div>
        </div>
      )}
    </div>
  );
};

DashboardCharts.propTypes = {
  stats: PropTypes.object,
  showMaintenanceVendorFeatures: PropTypes.bool
};

export default DashboardCharts;
