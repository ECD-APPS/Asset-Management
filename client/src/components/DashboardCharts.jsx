import Chart from 'react-apexcharts';
import PropTypes from 'prop-types';
import { 
  Box, 
  CheckCircle, 
  LayoutGrid, 
  Trash2,
  TrendingUp
} from 'lucide-react';

const StatCard = ({ title, value, icon: Icon, color, subText }) => (
  <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 flex items-center justify-between relative overflow-hidden group hover:shadow-md transition-shadow">
    <div className={`absolute left-0 top-0 bottom-0 w-1 bg-${color}-500`}></div>
    <div>
      <h3 className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-1">{title}</h3>
      <div className="flex items-baseline space-x-2">
        <p className="text-3xl font-bold text-gray-800">{value}</p>
        {subText && <span className="text-xs text-gray-400">{subText}</span>}
      </div>
    </div>
    <div className={`p-3 rounded-lg bg-${color}-50 text-${color}-500 group-hover:bg-${color}-100 transition-colors`}>
      <Icon className="w-6 h-6" />
    </div>
  </div>
);

StatCard.propTypes = {
  title: PropTypes.string.isRequired,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  icon: PropTypes.elementType.isRequired,
  color: PropTypes.string.isRequired,
  subText: PropTypes.string
};

const DashboardCharts = ({ stats }) => {
  if (!stats) return <div className="p-8 text-center text-gray-500">Loading dashboard data...</div>;

  const { overview, models, growth } = stats;
  
  const safeOverview = overview || {
    total: 0,
    inUse: 0,
    spare: 0,
    faulty: 0,
    disposed: 0,
    pendingReturns: 0,
    pendingRequests: 0
  };

  // ApexCharts Options for Donut
  const donutOptions = {
    chart: {
      type: 'donut',
      fontFamily: 'inherit'
    },
    labels: ['In Use', 'Spare', 'Faulty', 'Disposed'],
    colors: ['#10b981', '#f59e0b', '#ef4444', '#6b7280'],
    plotOptions: {
      pie: {
        donut: {
          size: '70%',
          labels: {
            show: true,
            total: {
              show: true,
              label: 'Total',
              formatter: function (w) {
                return w.globals.seriesTotals.reduce((a, b) => a + b, 0);
              }
            }
          }
        }
      }
    },
    dataLabels: {
      enabled: false
    },
    legend: {
      position: 'bottom'
    }
  };

  const donutSeries = [
    safeOverview.inUse, 
    safeOverview.spare, 
    safeOverview.faulty, 
    safeOverview.disposed
  ];

  // Filter out zero values if needed, but ApexCharts handles zeros gracefully usually.
  // Actually for donut it's better to keep indices aligned with labels.

  const modelData = (models || []).slice(0, 10);
  const hasModelData = modelData.length > 0;
  
  // ApexCharts Options for Bar
  const barOptions = {
    chart: {
      type: 'bar',
      toolbar: { show: false },
      fontFamily: 'inherit'
    },
    plotOptions: {
      bar: {
        borderRadius: 4,
        horizontal: true,
        barHeight: '60%',
        distributed: false
      }
    },
    dataLabels: {
      enabled: true,
      textAnchor: 'start',
      style: { colors: ['#fff'] },
      formatter: function (val) {
        return val || 0;
      },
      offsetX: 0,
    },
    colors: ['#3b82f6'],
    xaxis: {
      categories: hasModelData ? modelData.map(m => m.name) : [],
    },
    grid: {
      borderColor: '#f3f4f6',
      xaxis: { lines: { show: true } }
    },
    tooltip: {
      theme: 'light',
      y: {
        formatter: function (val) {
          return val
        }
      }
    }
  };

  const barSeries = [{
    name: 'Assets',
    data: hasModelData ? modelData.map(m => m.value) : []
  }];

  // Growth Chart Options
  const growthOptions = {
    chart: {
      type: 'area',
      toolbar: { show: false },
      fontFamily: 'inherit',
      animations: { enabled: true }
    },
    dataLabels: { enabled: false },
    stroke: { curve: 'smooth', width: 2 },
    xaxis: {
      categories: (growth || []).map(g => g.name),
      axisBorder: { show: false },
      axisTicks: { show: false }
    },
    yaxis: { show: false },
    grid: { show: false, padding: { left: 0, right: 0 } },
    colors: ['#3b82f6'],
    fill: {
      type: 'gradient',
      gradient: {
        shadeIntensity: 1,
        opacityFrom: 0.4,
        opacityTo: 0.1,
        stops: [0, 90, 100]
      }
    },
    tooltip: {
      y: { formatter: (val) => `${val} Assets` }
    }
  };

  const growthSeries = [{
    name: 'New Assets',
    data: (growth || []).map(g => g.value)
  }];

  return (
    <div className="space-y-6">
      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard 
          title="Total Assets" 
          value={safeOverview.total} 
          icon={Box} 
          color="blue" 
          subText="In Inventory"
        />
        <StatCard 
          title="In Use" 
          value={safeOverview.inUse} 
          icon={CheckCircle} 
          color="emerald" 
          subText={`${safeOverview.total ? Math.round((safeOverview.inUse / safeOverview.total) * 100) : 0}% Utilization`}
        />
        <StatCard 
          title="Spare" 
          value={safeOverview.spare} 
          icon={LayoutGrid} 
          color="amber" 
          subText="Ready to assign"
        />
        <StatCard 
          title="Faulty / Disposed" 
          value={safeOverview.faulty + safeOverview.disposed} 
          icon={Trash2} 
          color="red" 
          subText={`${safeOverview.faulty} Faulty, ${safeOverview.disposed} Disposed`}
        />
      </div>

      {/* Main Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-gray-800 font-bold mb-4">Asset Allocation</h3>
          <Chart options={donutOptions} series={donutSeries} type="donut" height={300} />
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-gray-800 font-bold mb-4">Top 10 Asset Models</h3>
          {hasModelData ? (
            <Chart options={barOptions} series={barSeries} type="bar" height={300} />
          ) : (
            <div className="h-[300px] flex items-center justify-center text-gray-400 text-sm italic border-2 border-dashed border-gray-100 rounded-lg">
              No asset model data available
            </div>
          )}
        </div>
      </div>

      {/* Growth Trend Chart (Powerful Feature) */}
      {(growth || []).length > 0 && (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-4">
             <h3 className="text-gray-800 font-bold flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-blue-500" />
                Asset Acquisition Trend (Last 6 Months)
             </h3>
          </div>
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
