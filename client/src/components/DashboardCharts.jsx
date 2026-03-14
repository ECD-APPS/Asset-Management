import Chart from 'react-apexcharts';
import PropTypes from 'prop-types';
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
  ocean: { primary: '#0284c7', secondary: '#0ea5e9', tertiary: '#22d3ee' },
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

const buildPieConfig = ({ labels, values, colors, title, height = 280 }) => {
  const validValues = Array.isArray(values) ? values.map((n) => Number(n) || 0) : [];
  const total = validValues.reduce((sum, value) => sum + value, 0);
  const hasData = total > 0;
  const safeLabels = hasData ? labels : ['No Data'];
  const safeValues = hasData ? validValues : [1];
  const safeColors = hasData ? colors : ['#cbd5e1'];
  return {
    title,
    height,
    series: safeValues,
    options: {
      chart: { type: 'donut', fontFamily: 'inherit' },
      labels: safeLabels,
      colors: safeColors,
      stroke: { width: 1, colors: ['#fff'] },
      legend: { position: 'bottom' },
      dataLabels: {
        enabled: hasData,
        formatter: (val) => `${Math.round(val)}%`
      },
      tooltip: { y: { formatter: (value) => `${value}` } },
      plotOptions: {
        pie: {
          donut: {
            size: '68%',
            labels: {
              show: true,
              total: {
                show: true,
                label: hasData ? 'Total' : 'No Data',
                formatter: () => (hasData ? `${total}` : '-')
              }
            }
          }
        }
      }
    }
  };
};

const DashboardCharts = ({ stats }) => {
  if (!stats) return <div className="p-8 text-center text-gray-500">Loading dashboard data...</div>;

  const { overview, growth, conditions, usageBreakdown, locations, products } = stats;
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
  const inUseCount = safeOverview.inUse || 0;
  const notInUseCount = Math.max((safeOverview.total || 0) - inUseCount, 0);

  const utilizationPie = buildPieConfig({
    labels: ['In Use', 'Not In Use'],
    values: [inUseCount, notInUseCount],
    colors: [palette.primary, palette.secondary],
    title: 'Asset Utilization',
    height: 300
  });
  const conditionPie = buildPieConfig({
    labels: ['New', 'Used', 'Faulty', 'Repaired'],
    values: [conditions?.New || 0, conditions?.Used || 0, conditions?.Faulty || 0, conditions?.Repaired || 0],
    colors: ['#22c55e', '#3b82f6', '#ef4444', '#f59e0b'],
    title: 'Condition Mix'
  });
  const usagePie = buildPieConfig({
    labels: ['Installed', 'Used', 'Faulty', 'Other'],
    values: [usageBreakdown?.installed || 0, usageBreakdown?.used || 0, usageBreakdown?.faulty || 0, usageBreakdown?.other || 0],
    colors: ['#2563eb', '#16a34a', '#dc2626', '#64748b'],
    title: 'Usage Classification'
  });
  const topLocations = (locations || []).slice(0, 5);
  const locationPie = buildPieConfig({
    labels: topLocations.map((item) => item.name || 'Unknown'),
    values: topLocations.map((item) => item.value || 0),
    colors: ['#0ea5e9', '#8b5cf6', '#14b8a6', '#f97316', '#a3e635'],
    title: 'Top Locations by Quantity'
  });
  const topProducts = (products || []).slice(0, 5);
  const productPie = buildPieConfig({
    labels: topProducts.map((item) => item.name || 'Unknown'),
    values: topProducts.map((item) => item.value || 0),
    colors: ['#6366f1', '#06b6d4', '#84cc16', '#fb7185', '#f59e0b'],
    title: 'Top Products by Quantity'
  });

  const navigateToAssets = (status) => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    const query = params.toString();
    window.open(`/assets${query ? `?${query}` : ''}`, '_blank', 'noopener,noreferrer');
  };

  const barOptions = {
    chart: { type: 'bar', toolbar: { show: false }, fontFamily: 'inherit' },
    plotOptions: { bar: { borderRadius: 4, horizontal: true, barHeight: '60%' } },
    dataLabels: {
      enabled: true,
      textAnchor: 'start',
      style: { colors: ['#fff'] },
      formatter: (val) => val || 0
    },
    colors: [palette.primary],
    xaxis: { categories: ['In Store', 'Faulty', 'Missing'] },
    grid: { borderColor: '#e2e8f0', xaxis: { lines: { show: true } } }
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
        <div className="bg-app-card p-6 rounded-xl xl:col-span-4">
          <h3 className="text-app-main font-bold mb-4 flex items-center gap-2"><PieChart size={18} className="text-app-accent" />{utilizationPie.title}</h3>
          <Chart options={utilizationPie.options} series={utilizationPie.series} type="donut" height={utilizationPie.height} />
        </div>
        <div className="bg-app-card p-6 rounded-xl xl:col-span-4">
          <h3 className="text-app-main font-bold mb-4 flex items-center gap-2"><PieChart size={18} className="text-app-accent" />{conditionPie.title}</h3>
          <Chart options={conditionPie.options} series={conditionPie.series} type="donut" height={conditionPie.height} />
        </div>
        <div className="bg-app-card p-6 rounded-xl xl:col-span-4">
          <h3 className="text-app-main font-bold mb-4 flex items-center gap-2"><PieChart size={18} className="text-app-accent" />{usagePie.title}</h3>
          <Chart options={usagePie.options} series={usagePie.series} type="donut" height={usagePie.height} />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className="bg-app-card p-6 rounded-xl xl:col-span-4">
          <h3 className="text-app-main font-bold mb-4 flex items-center gap-2"><PieChart size={18} className="text-app-accent" />{locationPie.title}</h3>
          <Chart options={locationPie.options} series={locationPie.series} type="donut" height={locationPie.height} />
        </div>
        <div className="bg-app-card p-6 rounded-xl xl:col-span-4">
          <h3 className="text-app-main font-bold mb-4 flex items-center gap-2"><PieChart size={18} className="text-app-accent" />{productPie.title}</h3>
          <Chart options={productPie.options} series={productPie.series} type="donut" height={productPie.height} />
        </div>
        <div className="bg-app-card p-6 rounded-xl xl:col-span-4">
          <h3 className="text-app-main font-bold mb-4">In Store vs Faulty vs Missing</h3>
          <Chart options={barOptions} series={barSeries} type="bar" height={300} />
        </div>
      </div>

      {(growth || []).length > 0 && (
        <div className="bg-app-card p-6 rounded-xl">
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
  stats: PropTypes.object
};

export default DashboardCharts;
