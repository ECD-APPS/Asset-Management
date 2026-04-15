import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import DashboardCharts from '../components/DashboardCharts';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  Bell,
  ArrowDownLeft,
  ArrowRight,
  Package,
  LayoutDashboard,
  Sparkles,
  Clock,
  SlidersHorizontal,
  X,
  RotateCcw,
} from 'lucide-react';
import AppSpinner from '../components/AppSpinner';

/** Avoid stacking ApiLoadingOverlay on top of this page’s own loading UI. */
const DASHBOARD_API = { headers: { 'X-Skip-Global-Loading': '1' } };

/** Vendor scope switches re-hit a heavy /assets/stats pipeline; cache + prefetch keeps Siemens/G42 snappy. */
const DASHBOARD_STATS_CACHE_TTL_MS = 2 * 60 * 1000;
const DASHBOARD_PREFETCH_VENDORS = ['Siemens', 'G42'];

function isAbortLike(error) {
  const c = error?.code;
  const n = error?.name;
  return c === 'ERR_CANCELED' || n === 'CanceledError' || n === 'AbortError';
}

const DASHBOARD_LAYOUT_VERSION = 1;
const DEFAULT_ANALYTICS_SECTION_ORDER = [
  'key_metrics',
  'utilization_fleet',
  'locations_products_status',
  'maintenance_vendors',
  'growth'
];

const DEFAULT_DASHBOARD_LAYOUT = {
  bannerCards: {
    consumables: true,
    tools: true,
    lowStock: true,
    toolsStatus: true
  },
  showInsightsStrip: true,
  chartWidgets: {
    utilizationPie: true,
    fleetStatusAssetsPie: true,
    fleetStatusQuantityPie: true,
    lifecycleAssetsPie: true,
    lifecycleQuantityPie: true,
    topLocationsPie: true,
    topProductsPie: true,
    inventoryExceptionsBar: true,
    lifecycleBar: true,
    siemensPie: true,
    g42Pie: true,
    maintenanceMixPie: true,
    growthArea: true
  },
  showPendingAlerts: true,
  showRecentActivity: true,
  analyticsOrder: DEFAULT_ANALYTICS_SECTION_ORDER
};

const formatRelativeTime = (iso) => {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const sec = Math.round((Date.now() - then) / 1000);
  if (sec < 45) return 'Just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  return new Date(iso).toLocaleString();
};

const normalizeStats = (raw) => {
  const src = raw && typeof raw === 'object' ? raw : {};
  const overview = src.overview && typeof src.overview === 'object' ? src.overview : {};
  return {
    ...src,
    overview: {
      total: Number(overview.total || 0),
      totalQuantity: Number(overview.totalQuantity || 0),
      inUse: Number(overview.inUse || 0),
      inUseQuantity: Number(overview.inUseQuantity || 0),
      inStore: Number(overview.inStore || 0),
      inStoreQuantity: Number(overview.inStoreQuantity || 0),
      missing: Number(overview.missing || 0),
      missingQuantity: Number(overview.missingQuantity || 0),
      disposed: Number(overview.disposed || 0),
      disposedQuantity: Number(overview.disposedQuantity || 0),
      reserved: Number(overview.reserved || 0),
      reservedQuantity: Number(overview.reservedQuantity || 0),
      repaired: Number(overview.repaired || 0),
      repairedQuantity: Number(overview.repairedQuantity || 0),
      underRepairWorkshop: Number(overview.underRepairWorkshop || 0),
      underRepairWorkshopQuantity: Number(overview.underRepairWorkshopQuantity || 0),
      faulty: Number(overview.faulty || 0),
      faultyQuantity: Number(overview.faultyQuantity || 0),
      lowStock: Number(overview.lowStock || 0),
      pendingReturns: Number(overview.pendingReturns || 0),
      pendingRequests: Number(overview.pendingRequests || 0),
      assetTypes: Number(overview.assetTypes || 0),
      activeTotal: Number(overview.activeTotal || 0)
    },
    conditions: src.conditions && typeof src.conditions === 'object' ? src.conditions : {},
    products: Array.isArray(src.products) ? src.products : [],
    models: Array.isArray(src.models) ? src.models : [],
    locations: Array.isArray(src.locations) ? src.locations : [],
    categories: Array.isArray(src.categories) ? src.categories : [],
    growth: Array.isArray(src.growth) ? src.growth : [],
    lowStockThreshold: Number(src.lowStockThreshold || 5),
    lowStockItems: Array.isArray(src.lowStockItems) ? src.lowStockItems : [],
    maintenanceVendors: src.maintenanceVendors && typeof src.maintenanceVendors === 'object' ? src.maintenanceVendors : { Siemens: 0, G42: 0, Other: 0 },
    maintenanceVendorAssets:
      src.maintenanceVendorAssets && typeof src.maintenanceVendorAssets === 'object'
        ? src.maintenanceVendorAssets
        : { Siemens: 0, G42: 0, Other: 0 },
    recurringFaultyByAbs: Array.isArray(src.recurringFaultyByAbs) ? src.recurringFaultyByAbs : []
  };
};

const Dashboard = () => {
  const { user, activeStore } = useAuth();
  const activeStoreCacheKey = activeStore?._id ?? activeStore ?? null;
  const [searchParams] = useSearchParams();
  const [stats, setStats] = useState(null);
  const [consumablesStats, setConsumablesStats] = useState(null);
  const [toolsStats, setToolsStats] = useState(null);
  const [consumablesError, setConsumablesError] = useState('');
  const [toolsError, setToolsError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [recentAssets, setRecentAssets] = useState([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [showLowStockPanel, setShowLowStockPanel] = useState(false);
  const lowStockTriggerRef = useRef(null);
  const lowStockOverlayRef = useRef(null);
  const fetchSeqRef = useRef(0);
  const recentRidRef = useRef(0);
  const statsRef = useRef(null);
  /** Map cacheKey -> { data, ts } for normalized stats (stale-while-revalidate). */
  const statsCacheRef = useRef(new Map());
  /** Map cacheKey -> Promise resolving to normalized stats (dedupe concurrent calls). */
  const statsInflightRef = useRef(new Map());
  const vendorPrefetchRef = useRef({ storeKey: '', running: false, done: false });

  useEffect(() => {
    statsRef.current = stats;
  }, [stats]);

  useEffect(() => {
    statsCacheRef.current.clear();
    statsInflightRef.current.clear();
    vendorPrefetchRef.current = { storeKey: '', running: false, done: false };
  }, [activeStoreCacheKey]);

  const analyticsSectionOptions = useMemo(
    () => [
      { id: 'key_metrics', label: 'Key metrics' },
      { id: 'utilization_fleet', label: 'Utilization & fleet status' },
      { id: 'locations_products_status', label: 'Locations, products & status' },
      { id: 'maintenance_vendors', label: 'Maintenance vendors' },
      { id: 'growth', label: 'Growth' }
    ],
    []
  );

  const layoutKey = useMemo(() => {
    const keyPart = user?._id || user?.email || 'anon';
    return `dashboard_layout_v${DASHBOARD_LAYOUT_VERSION}:${keyPart}`;
  }, [user?._id, user?.email]);

  const [dashboardLayout, setDashboardLayout] = useState(DEFAULT_DASHBOARD_LAYOUT);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [draftLayout, setDraftLayout] = useState(null);

  const canCustomize = !!user && user?.role !== 'Viewer';

  const dashboardVendor = useMemo(() => {
    const v = searchParams.get('maintenance_vendor');
    if (v === 'Siemens' || v === 'G42') return v;
    return 'All';
  }, [searchParams]);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const scopeHints = [
    activeStore?.name,
    user?.assignedStore?.name,
    user?.name,
    user?.email
  ]
    .map((v) => String(v || '').trim())
    .filter(Boolean)
    .join(' ')
    .toUpperCase();
  const hasScyHint = scopeHints.includes('SCY');
  const hasItHint = scopeHints.includes('IT ASSET') || /\bIT\b/.test(scopeHints);
  const hasNocHint = scopeHints.includes('NOC ASSET') || /\bNOC\b/.test(scopeHints);
  // Prefer explicit SCY match; otherwise allow by default for non-IT/NOC scoped users.
  const isScyDashboard = hasScyHint || (!hasItHint && !hasNocHint && user?.role !== 'Super Admin');
  const assetsQuery = isScyDashboard && dashboardVendor !== 'All'
    ? `?maintenance_vendor=${encodeURIComponent(dashboardVendor)}`
    : '';
  const assetsLink = `/assets${assetsQuery}`;

  const buildStatsCacheKey = useCallback(
    (vendor) => {
      const storePart = String(activeStoreCacheKey ?? 'none');
      const v = isScyDashboard && vendor !== 'All' ? vendor : 'All';
      return `${storePart}:${v}`;
    },
    [activeStoreCacheKey, isScyDashboard]
  );

  const warmVendorCachesAfterAll = useCallback(() => {
    if (!isScyDashboard) return;
    const storeKey = String(activeStoreCacheKey ?? 'none');
    if (vendorPrefetchRef.current.storeKey !== storeKey) {
      vendorPrefetchRef.current = { storeKey, running: false, done: false };
    }
    if (vendorPrefetchRef.current.running || vendorPrefetchRef.current.done) return;
    vendorPrefetchRef.current.running = true;

    const run = async () => {
      for (const vendor of DASHBOARD_PREFETCH_VENDORS) {
        const key = buildStatsCacheKey(vendor);
        const ent = statsCacheRef.current.get(key);
        if (ent && Date.now() - ent.ts < DASHBOARD_STATS_CACHE_TTL_MS) continue;
        try {
          const res = await api.get('/assets/stats', { params: { maintenance_vendor: vendor }, ...DASHBOARD_API });
          statsCacheRef.current.set(key, { data: normalizeStats(res.data), ts: Date.now() });
        } catch {
          // Best effort warm-up only.
        }
      }
      vendorPrefetchRef.current.running = false;
      vendorPrefetchRef.current.done = true;
    };

    const ric = typeof window !== 'undefined' ? window.requestIdleCallback : null;
    if (typeof ric === 'function') {
      ric(() => {
        run().catch(() => {
          vendorPrefetchRef.current.running = false;
        });
      }, { timeout: 2000 });
      return;
    }
    run().catch(() => {
      vendorPrefetchRef.current.running = false;
    });
  }, [activeStoreCacheKey, buildStatsCacheKey, isScyDashboard]);

  useEffect(() => {
    // Per-user dashboard layout persistence (local-only for now).
    if (!layoutKey) return;
    try {
      const raw = localStorage.getItem(layoutKey);
      if (!raw) {
        setDashboardLayout(DEFAULT_DASHBOARD_LAYOUT);
        return;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        setDashboardLayout(DEFAULT_DASHBOARD_LAYOUT);
        return;
      }

      const loadedAnalyticsOrder = Array.isArray(parsed.analyticsOrder) ? parsed.analyticsOrder : [];
      const validSet = new Set(DEFAULT_ANALYTICS_SECTION_ORDER);
      const cleanedOrder = loadedAnalyticsOrder.filter((id) => validSet.has(id));
      const analyticsOrder =
        cleanedOrder.length > 0 ? cleanedOrder : DEFAULT_DASHBOARD_LAYOUT.analyticsOrder;

      const bannerCardsFromParsed = (() => {
        if (parsed.bannerCards && typeof parsed.bannerCards === 'object') {
          return {
            consumables: parsed.bannerCards.consumables !== false,
            tools: parsed.bannerCards.tools !== false,
            lowStock: parsed.bannerCards.lowStock !== false,
            toolsStatus: parsed.bannerCards.toolsStatus !== false
          };
        }
        // Backward compatibility: previously saved key was `showBannerKpis`.
        const showAll = parsed.showBannerKpis !== false;
        return {
          consumables: showAll,
          tools: showAll,
          lowStock: showAll,
          toolsStatus: showAll
        };
      })();

      setDashboardLayout({
        bannerCards: bannerCardsFromParsed,
        showInsightsStrip: parsed.showInsightsStrip !== false,
        chartWidgets: {
          ...DEFAULT_DASHBOARD_LAYOUT.chartWidgets,
          ...(parsed.chartWidgets && typeof parsed.chartWidgets === 'object' ? parsed.chartWidgets : {})
        },
        showPendingAlerts: parsed.showPendingAlerts !== false,
        showRecentActivity: parsed.showRecentActivity !== false,
        analyticsOrder
      });
    } catch {
      setDashboardLayout(DEFAULT_DASHBOARD_LAYOUT);
    }
  }, [layoutKey]);

  const persistLayout = (nextLayout) => {
    try {
      localStorage.setItem(layoutKey, JSON.stringify(nextLayout));
    } catch {
      // Non-blocking: keep dashboard usable without persistence.
    }
  };

  const startCustomize = () => {
    if (!canCustomize) return;
    setDraftLayout(dashboardLayout);
    setCustomizeOpen(true);
  };

  const cancelCustomize = () => {
    setCustomizeOpen(false);
    setDraftLayout(null);
  };

  const resetCustomize = () => {
    setDraftLayout(DEFAULT_DASHBOARD_LAYOUT);
  };

  const saveCustomize = () => {
    if (!draftLayout) return;
    const validSet = new Set(DEFAULT_ANALYTICS_SECTION_ORDER);
    const cleanedOrder = (draftLayout.analyticsOrder || []).filter((id) => validSet.has(id));
    const next = {
      bannerCards: {
        consumables: draftLayout.bannerCards?.consumables !== false,
        tools: draftLayout.bannerCards?.tools !== false,
        lowStock: draftLayout.bannerCards?.lowStock !== false,
        toolsStatus: draftLayout.bannerCards?.toolsStatus !== false
      },
      showInsightsStrip: draftLayout.showInsightsStrip !== false,
      chartWidgets: {
        ...DEFAULT_DASHBOARD_LAYOUT.chartWidgets,
        ...(draftLayout.chartWidgets && typeof draftLayout.chartWidgets === 'object' ? draftLayout.chartWidgets : {})
      },
      showPendingAlerts: draftLayout.showPendingAlerts !== false,
      showRecentActivity: draftLayout.showRecentActivity !== false,
      analyticsOrder: cleanedOrder.length > 0 ? cleanedOrder : DEFAULT_DASHBOARD_LAYOUT.analyticsOrder
    };
    setDashboardLayout(next);
    persistLayout(next);
    cancelCustomize();
  };

  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    const fetchSeq = ++fetchSeqRef.current;
    const effectStartMs = Date.now();
    const isStale = () => cancelled || fetchSeq !== fetchSeqRef.current;
    const withSignal = { ...DASHBOARD_API, signal: ac.signal };
    const statsCacheKey = buildStatsCacheKey(dashboardVendor);

    const fetchStats = async () => {
      // #region agent log
      fetch('http://127.0.0.1:7852/ingest/e6725959-23a4-41d9-9ec9-16fd1ac382c3', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '513919' },
        body: JSON.stringify({
          sessionId: '513919',
          runId: 'dashboard-latency-pass2',
          hypothesisId: 'H1_H3',
          location: 'Dashboard.jsx:fetchStats:start',
          message: 'dashboard fetch started',
          data: {
            dashboardVendor,
            hasExistingStats: Boolean(statsRef.current),
            isScyDashboard
          },
          timestamp: Date.now()
        })
      }).catch(() => {});
      // #endregion
      const maxAttempts = 3;
      let lastError = null;
      const hadStats = Boolean(statsRef.current);
      let cached = statsCacheRef.current.get(statsCacheKey);
      if (cached && Date.now() - cached.ts >= DASHBOARD_STATS_CACHE_TTL_MS) {
        statsCacheRef.current.delete(statsCacheKey);
        cached = null;
      }
      const cacheFresh = Boolean(cached?.data);
      if (!isStale()) {
        if (cacheFresh && cached?.data) {
          setStats(cached.data);
          setLastUpdated(new Date(cached.ts));
          if (hadStats) setRefreshing(false);
          else setLoading(false);
        } else if (hadStats) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }
      }
      if (cacheFresh && cached?.data) {
        if (dashboardVendor === 'All') warmVendorCachesAfterAll();
        return;
      }
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          if (!isStale()) setError(null);
          const vendorFilter = isScyDashboard && dashboardVendor !== 'All' ? { maintenance_vendor: dashboardVendor } : {};
          const statsParams = vendorFilter;
          const recentParams = { page: 1, limit: 8, light: 1, ...vendorFilter };

          const recentRid = ++recentRidRef.current;
          if (!isStale()) setRecentLoading(true);
          const recentP = api.get('/assets', { params: recentParams, ...withSignal });

          const inflightKey = statsCacheKey;
          const existingInflight = statsInflightRef.current.get(inflightKey);
          const statsPromise = existingInflight || api
            .get('/assets/stats', { params: statsParams, ...DASHBOARD_API })
            .then((res) => normalizeStats(res.data))
            .finally(() => {
              statsInflightRef.current.delete(inflightKey);
            });
          if (!existingInflight) {
            statsInflightRef.current.set(inflightKey, statsPromise);
          }
          const [statsSettled] = await Promise.allSettled([statsPromise]);
          if (isStale()) return;

          if (statsSettled.status === 'rejected') {
            throw statsSettled.reason;
          }

          const normalized = statsSettled.value;
          statsCacheRef.current.set(statsCacheKey, { data: normalized, ts: Date.now() });
          setStats(normalized);
          setLastUpdated(new Date());
          // #region agent log
          fetch('http://127.0.0.1:7852/ingest/e6725959-23a4-41d9-9ec9-16fd1ac382c3', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '513919' },
            body: JSON.stringify({
              sessionId: '513919',
              runId: 'dashboard-latency-pass2',
              hypothesisId: 'H1_H3',
              location: 'Dashboard.jsx:fetchStats:success',
              message: 'dashboard stats applied',
              data: {
                dashboardVendor,
                elapsedMs: Date.now() - effectStartMs
              },
              timestamp: Date.now()
            })
          }).catch(() => {});
          // #endregion

          // One paint: KPI row + charts (recent table may still stream).
          if (!isStale()) {
            setLoading(false);
            setRefreshing(false);
          }
          if (dashboardVendor === 'All') warmVendorCachesAfterAll();

          recentP
            .then((recentResponse) => {
              if (isStale() || recentRid !== recentRidRef.current) return;
              setRecentAssets(recentResponse.data?.assets || recentResponse.data?.items || []);
            })
            .catch((e) => {
              if (isAbortLike(e) || isStale() || recentRid !== recentRidRef.current) return;
              console.warn('Failed to load recent assets:', e);
              setRecentAssets([]);
            })
            .finally(() => {
              if (isStale() || recentRid !== recentRidRef.current) return;
              setRecentLoading(false);
            });

          lastError = null;
          break;
        } catch (error) {
          if (isAbortLike(error)) {
            if (!isStale()) {
              setLoading(false);
              setRefreshing(false);
              setRecentLoading(false);
            }
            return;
          }
          lastError = error;
          const status = error?.response?.status;
          const transient = !status || status >= 500 || status === 429 || error?.code === 'ECONNABORTED' || error?.message === 'Network Error';
          if (!transient || attempt === maxAttempts) break;
          await sleep(250 * attempt);
        }
      }
      if (lastError) {
        if (isStale()) return;
        console.error('Error fetching stats:', lastError);
        // #region agent log
        fetch('http://127.0.0.1:7852/ingest/e6725959-23a4-41d9-9ec9-16fd1ac382c3', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '513919' },
          body: JSON.stringify({
            sessionId: '513919',
            runId: 'dashboard-latency-pass2',
            hypothesisId: 'H5',
            location: 'Dashboard.jsx:fetchStats:error',
            message: 'dashboard stats failed',
            data: {
              dashboardVendor,
              elapsedMs: Date.now() - effectStartMs,
              status: Number(lastError?.response?.status || 0),
              code: String(lastError?.code || '')
            },
            timestamp: Date.now()
          })
        }).catch(() => {});
        // #endregion
        setRecentLoading(false);
        if (!statsRef.current) {
          const scopeLabel = isScyDashboard && dashboardVendor !== 'All' ? `${dashboardVendor} ` : '';
          setError(`Failed to load ${scopeLabel}dashboard data. Please try refreshing.`);
        }
      }
      if (!isStale()) {
        setLoading(false);
        setRefreshing(false);
      }
    };

    fetchStats();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [dashboardVendor, isScyDashboard, activeStoreCacheKey, buildStatsCacheKey, warmVendorCachesAfterAll]);

  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    const withSignal = { ...DASHBOARD_API, signal: ac.signal };

    const fetchAuxStats = async () => {
      const [consumablesSettled, toolsSettled] = await Promise.allSettled([
        api.get('/consumables/stats', withSignal),
        api.get('/tools/stats', withSignal)
      ]);
      if (cancelled) return;

      if (consumablesSettled.status === 'fulfilled') {
        setConsumablesStats(consumablesSettled.value.data || {});
        setConsumablesError('');
      } else {
        const e = consumablesSettled.reason;
        if (isAbortLike(e)) return;
        console.warn('Failed to load consumables stats:', e);
        setConsumablesStats({});
        setConsumablesError(e?.response?.data?.message || e?.message || 'Unknown error');
      }

      if (toolsSettled.status === 'fulfilled') {
        setToolsStats(toolsSettled.value.data || {});
        setToolsError('');
      } else {
        const e = toolsSettled.reason;
        if (isAbortLike(e)) return;
        console.warn('Failed to load tools stats:', e);
        setToolsStats({});
        setToolsError(e?.response?.data?.message || e?.message || 'Unknown error');
      }
    };

    fetchAuxStats().catch((error) => {
      if (isAbortLike(error) || cancelled) return;
      console.warn('Failed to load auxiliary dashboard stats:', error);
    });

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [activeStore?._id]);

  useEffect(() => {
    const onDocClick = (event) => {
      const t = event.target;
      if (lowStockTriggerRef.current?.contains(t)) return;
      if (lowStockOverlayRef.current?.contains(t)) return;
      setShowLowStockPanel(false);
    };
    if (showLowStockPanel) {
      document.addEventListener('mousedown', onDocClick);
    }
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [showLowStockPanel]);

  if (loading && !stats) {
    return (
      <div
        className="isolate flex min-h-[70vh] flex-col items-center justify-center bg-app-page px-4"
        style={{ WebkitFontSmoothing: 'antialiased' }}
      >
        {/* Single flat layer (no backdrop-blur / translucent card) avoids compositor “double” edges on some GPUs */}
        <div className="flex w-full max-w-sm flex-col items-center rounded-2xl border border-app-card bg-app-card px-8 py-12 shadow-card">
          <AppSpinner
            message="Loading dashboard"
            subMessage="Syncing live metrics and recent activity for your store."
            size="lg"
          />
        </div>
      </div>
    );
  }

  if (error && !stats) return (
    <div className="min-h-screen bg-app-page flex items-center justify-center p-6">
      <div className="bg-app-card p-8 rounded-2xl text-center max-w-md w-full border border-app-card shadow-lg">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-500/10">
          <AlertCircle className="h-8 w-8 text-rose-500" />
        </div>
        <h2 className="text-xl font-bold text-app-main mb-2">Couldn&apos;t load dashboard</h2>
        <p className="text-app-muted text-sm mb-6 leading-relaxed">{error}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="w-full sm:w-auto bg-app-accent text-white px-8 py-2.5 rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity shadow-sm"
        >
          Retry
        </button>
      </div>
    </div>
  );

  const o = stats?.overview || {};
  const consumablesTotalQty = consumablesStats?.totalQuantity ?? 0;
  const consumablesLowStockQty = consumablesStats?.lowStockQuantity ?? 0;
  const consumablesLowStockCount = consumablesStats?.lowStockCount ?? 0;
  const consumablesLowStockList = Array.isArray(consumablesStats?.lowStockItems)
    ? consumablesStats.lowStockItems
    : [];
  const consumablesItems = consumablesStats?.itemCount ?? 0;
  const assetLowStockCount = o.lowStock ?? 0;
  const totalLowStockBellCount = assetLowStockCount + consumablesLowStockCount;
  const assetLowStockItemsList = Array.isArray(stats?.lowStockItems) ? stats.lowStockItems : [];
  const toolsTotal = toolsStats?.total ?? 0;
  const toolsAvailable = toolsStats?.available ?? 0;
  const toolsIssued = toolsStats?.issued ?? 0;
  const toolsMaintenance = toolsStats?.maintenance ?? 0;

  const bannerCards = dashboardLayout?.bannerCards || {};
  const showConsumablesBanner = bannerCards.consumables !== false;
  const showToolsBanner = bannerCards.tools !== false;
  const showLowStockBanner = bannerCards.lowStock !== false;
  const showToolsStatusBanner = bannerCards.toolsStatus !== false;
  const showAnyBanner = showConsumablesBanner || showToolsBanner || showLowStockBanner || showToolsStatusBanner;

  return (
    <div className="min-h-screen bg-app-page space-y-6 text-app-main pb-10">
      <div className="relative overflow-visible rounded-2xl border border-app-card bg-app-card shadow-sm">
        <div className="absolute left-0 top-0 h-full w-1 bg-[rgb(var(--accent-color))]" aria-hidden />
        <div className="p-5 md:p-7 pl-6 md:pl-8">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
            <div className="flex items-start gap-4 min-w-0">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[rgb(var(--accent-color))]/10 text-[rgb(var(--accent-color))]">
                <LayoutDashboard className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl md:text-3xl font-bold text-app-main tracking-tight">Dashboard</h1>
                  <span className="inline-flex items-center gap-1 rounded-full border border-app-card bg-app-elevated px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-app-muted">
                    <Sparkles className="h-3 w-3 text-app-accent" />
                    Live
                    {refreshing && (
                      <span className="ml-1 inline-flex h-1.5 w-1.5 rounded-full bg-app-accent animate-pulse" title="Refreshing data" aria-hidden />
                    )}
                  </span>
                </div>
                <p className="text-app-muted mt-1.5 text-sm leading-relaxed">
                  Welcome back, <span className="font-semibold text-app-main">{user?.name}</span>
                  {isScyDashboard && dashboardVendor !== 'All' ? (
                    <> · Viewing <span className="font-medium text-app-main">{dashboardVendor}</span> analytics</>
                  ) : (
                    <> · Here&apos;s your fleet snapshot</>
                  )}
                </p>
                {canCustomize && (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={startCustomize}
                      className="inline-flex items-center gap-2 rounded-lg border border-app-card bg-app-elevated px-3 py-2 text-xs font-bold text-app-accent hover:bg-app-card transition-colors"
                      title="Customize which analytics sections appear and in what order"
                    >
                      <SlidersHorizontal className="w-4 h-4" />
                      Customize dashboard
                    </button>
                  </div>
                )}
                {lastUpdated && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-app-muted">
                    <Clock className="h-3.5 w-3.5 shrink-0 opacity-70" />
                    Data refreshed {lastUpdated.toLocaleTimeString()}
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <div className="relative" ref={lowStockTriggerRef}>
                <button
                  type="button"
                  onClick={() => setShowLowStockPanel((prev) => !prev)}
                  className="relative inline-flex items-center justify-center h-9 w-9 rounded-full border border-app-card bg-app-elevated text-app-main hover:bg-app-card transition-colors"
                  title={
                    totalLowStockBellCount > 0
                      ? `Low stock: ${assetLowStockCount} asset(s), ${consumablesLowStockCount} consumable(s) at/below min`
                      : 'Low stock notifications'
                  }
                >
                  <Bell className="h-4 w-4" />
                  {totalLowStockBellCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-rose-600 text-white text-[10px] leading-[1.1rem] text-center font-bold">
                      {totalLowStockBellCount > 99 ? '99+' : totalLowStockBellCount}
                    </span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showAnyBanner && (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {showConsumablesBanner && (
          <div className="rounded-xl border border-app-card bg-app-elevated px-4 py-3 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-wider text-app-muted">Consumables</p>
            <p className="text-xl font-bold text-app-main tabular-nums mt-0.5">
              {consumablesStats === null ? (
                <span className="inline-block h-7 w-14 rounded-md bg-app-card animate-pulse" aria-hidden />
              ) : (
                consumablesTotalQty
              )}
            </p>
            <p className="text-[11px] text-app-muted mt-0.5">
              {consumablesError ? `Error: ${consumablesError}` : consumablesStats === null ? 'Loading…' : `${consumablesItems} items in stock`}
            </p>
          </div>
        )}
        {showToolsBanner && (
          <div className="rounded-xl border border-app-card bg-app-elevated px-4 py-3 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-wider text-app-muted">Tools</p>
            <p className="text-xl font-bold text-app-main tabular-nums mt-0.5">
              {toolsStats === null ? (
                <span className="inline-block h-7 w-14 rounded-md bg-app-card animate-pulse" aria-hidden />
              ) : (
                toolsAvailable
              )}
            </p>
            <p className="text-[11px] text-app-muted mt-0.5">
              {toolsError ? `Error: ${toolsError}` : toolsStats === null ? 'Loading…' : `${toolsTotal} total tools`}
            </p>
          </div>
        )}
        {showLowStockBanner && (
          <div
            className={`rounded-xl border px-4 py-3 shadow-sm ${
              consumablesLowStockCount > 0
                ? 'border-rose-300/60 bg-rose-500/5'
                : 'border-app-card bg-app-elevated'
            }`}
          >
            <p className="text-[10px] font-bold uppercase tracking-wider text-app-muted">Low stock</p>
            <p className="text-xl font-bold text-app-main tabular-nums mt-0.5">
              {consumablesStats === null ? (
                <span className="inline-block h-7 w-14 rounded-md bg-app-card animate-pulse" aria-hidden />
              ) : (
                consumablesLowStockQty
              )}
            </p>
            <p className="text-[11px] text-app-muted mt-0.5">
              {consumablesStats === null
                ? 'Loading…'
                : consumablesLowStockCount > 0
                  ? `${consumablesLowStockCount} consumable(s) at/below min (total qty shown)`
                  : 'Consumables at/below min qty'}
            </p>
          </div>
        )}
        {showToolsStatusBanner && (
          <div className="rounded-xl border border-app-card bg-app-elevated px-4 py-3 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-wider text-app-muted">Tools status</p>
            <p className="text-xl font-bold text-app-main tabular-nums mt-0.5">
              {toolsStats === null ? (
                <span className="inline-block h-7 w-14 rounded-md bg-app-card animate-pulse" aria-hidden />
              ) : (
                toolsIssued + toolsMaintenance
              )}
            </p>
            <p className="text-[11px] text-app-muted mt-0.5">
              {toolsStats === null ? 'Loading…' : `${toolsIssued} issued + ${toolsMaintenance} maintenance`}
            </p>
          </div>
        )}
      </div>
      )}

      {dashboardLayout.showPendingAlerts !== false &&
        (stats?.overview?.pendingRequests > 0 ||
          (user?.role !== 'Viewer' && stats?.overview?.pendingReturns > 0) ||
          consumablesLowStockCount > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {stats.overview.pendingRequests > 0 && (
            <div className="relative overflow-hidden rounded-2xl border border-app-card bg-app-card p-5 flex items-start justify-between gap-4 hover:shadow-md transition-all duration-200">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-500 rounded-l-2xl" aria-hidden />
              <div className="flex items-start gap-4 pl-2 min-w-0">
                <div className="p-2.5 bg-amber-500/15 text-amber-600 rounded-xl shrink-0">
                  <Bell className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-app-main">Pending asset requests</h3>
                  <p className="text-sm text-app-muted mt-1">
                    <span className="font-bold text-amber-600 tabular-nums">{stats.overview.pendingRequests}</span>
                    {' '}technician request{stats.overview.pendingRequests !== 1 && 's'} awaiting approval.
                  </p>
                </div>
              </div>
              <Link
                to="/admin-requests"
                className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-700 hover:bg-amber-500/20 transition-colors"
              >
                Review <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          )}

          {user?.role !== 'Viewer' && stats.overview.pendingReturns > 0 && (
            <div className="relative overflow-hidden rounded-2xl border border-app-card bg-app-card p-5 flex items-start justify-between gap-4 hover:shadow-md transition-all duration-200">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-500 rounded-l-2xl" aria-hidden />
              <div className="flex items-start gap-4 pl-2 min-w-0">
                <div className="p-2.5 bg-indigo-500/15 text-indigo-600 rounded-xl shrink-0">
                  <ArrowDownLeft className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-app-main">Pending returns</h3>
                  <p className="text-sm text-app-muted mt-1">
                    <span className="font-bold text-indigo-600 tabular-nums">{stats.overview.pendingReturns}</span>
                    {' '}asset{stats.overview.pendingReturns !== 1 && 's'} waiting for confirmation.
                  </p>
                </div>
              </div>
              <Link
                to="/receive-process"
                className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-indigo-500/10 px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-500/20 transition-colors"
              >
                Process <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          )}

          {consumablesLowStockCount > 0 && (
            <div className="relative overflow-hidden rounded-2xl border border-app-card bg-app-card p-5 flex items-start justify-between gap-4 hover:shadow-md transition-all duration-200">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-rose-500 rounded-l-2xl" aria-hidden />
              <div className="flex items-start gap-4 pl-2 min-w-0">
                <div className="p-2.5 bg-rose-500/15 text-rose-600 rounded-xl shrink-0">
                  <Package className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-app-main">Consumables low stock</h3>
                  <p className="text-sm text-app-muted mt-1">
                    <span className="font-bold text-rose-600 tabular-nums">{consumablesLowStockCount}</span>
                    {' '}
                    consumable{consumablesLowStockCount !== 1 && 's'} at or below minimum quantity (restock).
                  </p>
                </div>
              </div>
              <Link
                to="/consumables"
                className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-500/20 transition-colors"
              >
                View <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          )}
        </div>
      )}

      <section aria-label="Analytics and charts" className="space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-widest text-app-muted px-0.5">Analytics</h2>
        <DashboardCharts
          stats={stats}
          showMaintenanceVendorFeatures={isScyDashboard}
          selectedMaintenanceVendor={isScyDashboard ? dashboardVendor : 'All'}
          analyticsSectionOrder={dashboardLayout.analyticsOrder}
          showInsightsStrip={dashboardLayout.showInsightsStrip !== false}
          chartWidgets={dashboardLayout.chartWidgets || DEFAULT_DASHBOARD_LAYOUT.chartWidgets}
        />
      </section>

      {dashboardLayout.showRecentActivity !== false && (
      <div className="rounded-2xl border border-app-card bg-app-card shadow-sm overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-app-card px-5 py-4 bg-app-elevated/30">
          <div>
            <h2 className="text-base font-bold text-app-main">Recent asset activity</h2>
            <p className="text-xs text-app-muted mt-0.5">
              {recentLoading && recentAssets.length === 0
                ? 'Loading recent updates…'
                : `Last ${recentAssets.length} updated ${recentAssets.length === 1 ? 'record' : 'records'}`}
            </p>
          </div>
          <Link
            to={assetsLink}
            className="inline-flex items-center gap-1.5 rounded-lg border border-app-card bg-app-card px-3 py-2 text-xs font-bold text-app-accent hover:bg-app-elevated transition-colors shrink-0"
          >
            View all <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-app-muted border-b border-app-card bg-app-elevated/20">
                <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-wider">Asset</th>
                <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-wider">Status</th>
                <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-wider">Location</th>
                <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-wider">Updated</th>
              </tr>
            </thead>
            <tbody>
              {recentLoading && recentAssets.length === 0 && [0, 1, 2].map((i) => (
                <tr key={`sk-${i}`} className="border-b border-app-card last:border-0">
                  <td className="px-5 py-3.5" colSpan={4}>
                    <div className="flex gap-4 animate-pulse">
                      <div className="h-10 flex-1 max-w-xs rounded-lg bg-app-elevated" />
                      <div className="h-10 w-24 rounded-lg bg-app-elevated" />
                      <div className="h-10 flex-1 max-w-[10rem] rounded-lg bg-app-elevated" />
                      <div className="h-10 w-20 rounded-lg bg-app-elevated" />
                    </div>
                  </td>
                </tr>
              ))}
              {!recentLoading && recentAssets.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-14 text-center text-app-muted">
                    <div className="inline-flex flex-col items-center gap-3 max-w-xs mx-auto">
                      <div className="p-4 rounded-2xl bg-app-elevated border border-app-card">
                        <Package className="w-8 h-8 opacity-40" />
                      </div>
                      <p className="text-sm font-medium text-app-main">No recent activity</p>
                      <p className="text-xs leading-relaxed">Assets will appear here after updates, or try widening your vendor filter.</p>
                    </div>
                  </td>
                </tr>
              )}
              {recentAssets.map((asset) => (
                <tr key={asset._id} className="border-b border-app-card last:border-0 hover:bg-app-elevated/40 transition-colors">
                  <td className="px-5 py-3.5 align-middle">
                    <div className="font-semibold text-app-main">{asset.name || '—'}</div>
                    <div className="text-xs text-app-muted font-mono mt-0.5">{asset.serial_number || '—'}</div>
                  </td>
                  <td className="px-5 py-3.5 align-middle">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
                        asset.status === 'In Use'
                          ? 'bg-emerald-500/15 text-emerald-700'
                          : asset.status === 'In Store'
                            ? 'bg-sky-500/15 text-sky-700'
                            : String(asset.condition || '').toLowerCase().includes('faulty')
                              ? 'bg-rose-500/15 text-rose-700'
                              : asset.status === 'Missing'
                                ? 'bg-orange-500/15 text-orange-700'
                                : 'bg-app-elevated text-app-muted'
                      }`}
                    >
                      {asset.status || 'Unknown'}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-app-main/90 align-middle">{asset.location || asset.store?.name || '—'}</td>
                  <td className="px-5 py-3.5 align-middle">
                    <span className="text-app-muted tabular-nums text-xs block" title={asset.updatedAt ? new Date(asset.updatedAt).toLocaleString() : ''}>
                      {formatRelativeTime(asset.updatedAt)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {customizeOpen && draftLayout && (
        <div className="fixed inset-0 z-[10000]">
          <button
            type="button"
            className="absolute inset-0 bg-black/30"
            onMouseDown={cancelCustomize}
            aria-label="Close customize panel"
          />
          <div className="relative mx-auto mt-10 w-full max-w-2xl bg-app-page border border-app-card rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-start justify-between gap-3 border-b border-app-card px-5 py-4 bg-app-elevated/30">
              <div className="min-w-0">
                <h3 className="text-base font-bold text-app-main">Customize dashboard</h3>
                <p className="text-xs text-app-muted mt-1">Choose which sections show up on your dashboard.</p>
              </div>
              <button
                type="button"
                onClick={cancelCustomize}
                className="p-2 rounded-lg border border-app-card bg-app-card text-app-muted hover:bg-app-elevated transition-colors"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-6 max-h-[70vh] overflow-y-auto">
              <div className="space-y-3">
                <h4 className="text-sm font-bold text-app-main">Layout</h4>

                <div className="space-y-3">
                  <h5 className="text-xs font-bold uppercase tracking-wider text-app-muted">Banner cards</h5>

                  <label className="flex items-center justify-between gap-3 p-3 rounded-xl border border-app-card bg-app-elevated">
                    <span className="text-sm font-semibold text-app-main">Consumables</span>
                    <input
                      type="checkbox"
                      checked={draftLayout.bannerCards?.consumables !== false}
                      onChange={(e) =>
                        setDraftLayout((prev) => ({
                          ...prev,
                          bannerCards: { ...(prev.bannerCards || {}), consumables: e.target.checked }
                        }))
                      }
                    />
                  </label>

                  <label className="flex items-center justify-between gap-3 p-3 rounded-xl border border-app-card bg-app-elevated">
                    <span className="text-sm font-semibold text-app-main">Tools</span>
                    <input
                      type="checkbox"
                      checked={draftLayout.bannerCards?.tools !== false}
                      onChange={(e) =>
                        setDraftLayout((prev) => ({
                          ...prev,
                          bannerCards: { ...(prev.bannerCards || {}), tools: e.target.checked }
                        }))
                      }
                    />
                  </label>

                  <label className="flex items-center justify-between gap-3 p-3 rounded-xl border border-app-card bg-app-elevated">
                    <span className="text-sm font-semibold text-app-main">Low stock</span>
                    <input
                      type="checkbox"
                      checked={draftLayout.bannerCards?.lowStock !== false}
                      onChange={(e) =>
                        setDraftLayout((prev) => ({
                          ...prev,
                          bannerCards: { ...(prev.bannerCards || {}), lowStock: e.target.checked }
                        }))
                      }
                    />
                  </label>

                  <label className="flex items-center justify-between gap-3 p-3 rounded-xl border border-app-card bg-app-elevated">
                    <span className="text-sm font-semibold text-app-main">Tools status</span>
                    <input
                      type="checkbox"
                      checked={draftLayout.bannerCards?.toolsStatus !== false}
                      onChange={(e) =>
                        setDraftLayout((prev) => ({
                          ...prev,
                          bannerCards: { ...(prev.bannerCards || {}), toolsStatus: e.target.checked }
                        }))
                      }
                    />
                  </label>
                </div>

                <label className="flex items-center justify-between gap-3 p-3 rounded-xl border border-app-card bg-app-elevated">
                  <span className="text-sm font-semibold text-app-main">Insights strip</span>
                  <input
                    type="checkbox"
                    checked={draftLayout.showInsightsStrip !== false}
                    onChange={(e) => setDraftLayout((prev) => ({ ...prev, showInsightsStrip: e.target.checked }))}
                  />
                </label>

                <label className="flex items-center justify-between gap-3 p-3 rounded-xl border border-app-card bg-app-elevated">
                  <span className="text-sm font-semibold text-app-main">Pending alerts</span>
                  <input
                    type="checkbox"
                    checked={draftLayout.showPendingAlerts !== false}
                    onChange={(e) => setDraftLayout((prev) => ({ ...prev, showPendingAlerts: e.target.checked }))}
                    disabled={user?.role === 'Viewer'}
                  />
                </label>

                <label className="flex items-center justify-between gap-3 p-3 rounded-xl border border-app-card bg-app-elevated">
                  <span className="text-sm font-semibold text-app-main">Recent activity</span>
                  <input
                    type="checkbox"
                    checked={draftLayout.showRecentActivity !== false}
                    onChange={(e) => setDraftLayout((prev) => ({ ...prev, showRecentActivity: e.target.checked }))}
                  />
                </label>
              </div>

              <div className="space-y-3">
                <h4 className="text-sm font-bold text-app-main">Analytics sections</h4>

                <div className="space-y-3">
                  {analyticsSectionOptions.map((opt) => {
                    const order = draftLayout.analyticsOrder || [];
                    const isIncluded = order.includes(opt.id);
                    const isMaintenanceDisabled = opt.id === 'maintenance_vendors' && !isScyDashboard;
                    const idx = order.indexOf(opt.id);

                    return (
                      <div
                        key={opt.id}
                        className="flex items-center justify-between gap-3 p-3 rounded-xl border border-app-card bg-app-elevated"
                      >
                        <label className={`flex items-center gap-3 min-w-0 ${isMaintenanceDisabled ? 'opacity-60' : ''}`}>
                          <input
                            type="checkbox"
                            checked={isIncluded}
                            disabled={isMaintenanceDisabled}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setDraftLayout((prev) => {
                                const prevOrder = (prev.analyticsOrder || []).slice();
                                if (checked) {
                                  if (!prevOrder.includes(opt.id)) prevOrder.push(opt.id);
                                  return { ...prev, analyticsOrder: prevOrder };
                                }
                                return { ...prev, analyticsOrder: prevOrder.filter((id) => id !== opt.id) };
                              });
                            }}
                          />
                          <span className="text-sm font-semibold text-app-main truncate">{opt.label}</span>
                        </label>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className="px-2 py-1 text-xs font-bold rounded-lg border border-app-card bg-app-card text-app-muted hover:bg-app-elevated transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            disabled={isMaintenanceDisabled || !isIncluded || idx <= 0}
                            onClick={() => {
                              setDraftLayout((prev) => {
                                const nextOrder = (prev.analyticsOrder || []).slice();
                                const curIdx = nextOrder.indexOf(opt.id);
                                if (curIdx <= 0) return prev;
                                const swapIdx = curIdx - 1;
                                const tmp = nextOrder[swapIdx];
                                nextOrder[swapIdx] = nextOrder[curIdx];
                                nextOrder[curIdx] = tmp;
                                return { ...prev, analyticsOrder: nextOrder };
                              });
                            }}
                          >
                            Up
                          </button>
                          <button
                            type="button"
                            className="px-2 py-1 text-xs font-bold rounded-lg border border-app-card bg-app-card text-app-muted hover:bg-app-elevated transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            disabled={
                              isMaintenanceDisabled ||
                              !isIncluded ||
                              idx === -1 ||
                              idx >= (draftLayout.analyticsOrder || []).length - 1
                            }
                            onClick={() => {
                              setDraftLayout((prev) => {
                                const nextOrder = (prev.analyticsOrder || []).slice();
                                const curIdx = nextOrder.indexOf(opt.id);
                                if (curIdx === -1 || curIdx >= nextOrder.length - 1) return prev;
                                const swapIdx = curIdx + 1;
                                const tmp = nextOrder[swapIdx];
                                nextOrder[swapIdx] = nextOrder[curIdx];
                                nextOrder[curIdx] = tmp;
                                return { ...prev, analyticsOrder: nextOrder };
                              });
                            }}
                          >
                            Down
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {!isScyDashboard && (
                  <p className="text-xs text-app-muted">Maintenance vendors section is available only for the SCY dashboard.</p>
                )}
              </div>

              <div className="space-y-3">
                <h4 className="text-sm font-bold text-app-main">Charts (Pie/Bar)</h4>
                {[
                  { key: 'utilizationPie', label: 'Asset Utilization' },
                  { key: 'fleetStatusAssetsPie', label: 'Fleet by status (assets)' },
                  { key: 'fleetStatusQuantityPie', label: 'Fleet by status (quantity)' },
                  { key: 'lifecycleAssetsPie', label: 'Lifecycle States (assets)' },
                  { key: 'lifecycleQuantityPie', label: 'Lifecycle States (quantity)' },
                  { key: 'topLocationsPie', label: 'Top Locations by Quantity' },
                  { key: 'topProductsPie', label: 'Top Products by Quantity' },
                  { key: 'inventoryExceptionsBar', label: 'In Store vs Faulty vs Missing vs Disposed' },
                  { key: 'lifecycleBar', label: 'Repaired vs Under Repair/Workshop vs Disposed' },
                  { key: 'siemensPie', label: 'Siemens' },
                  { key: 'g42Pie', label: 'G42' },
                  { key: 'maintenanceMixPie', label: 'Maintenance Vendor Mix' },
                  { key: 'growthArea', label: 'Growth (recurring ABS faults + acquisition trend)' }
                ].map((item) => {
                  const disabled = !isScyDashboard && ['siemensPie', 'g42Pie', 'maintenanceMixPie'].includes(item.key);
                  return (
                    <label
                      key={item.key}
                      className={`flex items-center justify-between gap-3 p-3 rounded-xl border border-app-card bg-app-elevated ${disabled ? 'opacity-60' : ''}`}
                    >
                      <span className="text-sm font-semibold text-app-main">{item.label}</span>
                      <input
                        type="checkbox"
                        disabled={disabled}
                        checked={draftLayout.chartWidgets?.[item.key] !== false}
                        onChange={(e) =>
                          setDraftLayout((prev) => ({
                            ...prev,
                            chartWidgets: {
                              ...(prev.chartWidgets || {}),
                              [item.key]: e.target.checked
                            }
                          }))
                        }
                      />
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-app-card px-5 py-4 bg-app-elevated/30">
              <button
                type="button"
                onClick={resetCustomize}
                className="inline-flex items-center gap-2 text-xs font-bold text-app-main hover:opacity-90 transition-opacity"
              >
                <RotateCcw className="w-4 h-4" />
                Reset
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={cancelCustomize}
                  className="px-4 py-2 rounded-xl border border-app-card bg-app-card text-xs font-bold text-app-main hover:bg-app-elevated transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveCustomize}
                  className="px-4 py-2 rounded-xl bg-app-accent text-white text-xs font-bold hover:opacity-90 transition-opacity shadow-sm"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showLowStockPanel && (
        <div className="fixed inset-0 z-[9999]" ref={lowStockOverlayRef}>
          <button
            type="button"
            aria-label="Close low stock panel"
            className="absolute inset-0 bg-black/30 cursor-default border-0 p-0"
            onMouseDown={() => setShowLowStockPanel(false)}
          />
          <div className="absolute top-0 right-0 z-10 h-full w-[26rem] max-w-[94vw] bg-white shadow-2xl border-l border-slate-200 flex flex-col">
            <div className="px-4 py-3 border-b border-slate-200 flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-slate-900">Low stock alerts</p>
                <p className="text-xs text-slate-500">
                  {assetLowStockCount > 0 && (
                    <>
                      {assetLowStockCount} asset(s) at or below qty {stats?.lowStockThreshold || 5}
                    </>
                  )}
                  {assetLowStockCount > 0 && consumablesLowStockCount > 0 && ' · '}
                  {consumablesLowStockCount > 0 && (
                    <>{consumablesLowStockCount} consumable(s) at or below min qty</>
                  )}
                  {totalLowStockBellCount === 0 && 'No alerts'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowLowStockPanel(false)}
                className="text-slate-500 hover:text-slate-700 text-sm font-semibold"
              >
                Close
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {totalLowStockBellCount === 0 ? (
                <div className="px-4 py-6 text-sm text-slate-500">No low stock items.</div>
              ) : (
                <>
                  {assetLowStockItemsList.length > 0 && (
                    <div className="px-4 pt-3 pb-1">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Assets</p>
                    </div>
                  )}
                  {assetLowStockItemsList.map((item) => (
                    <div key={item._id} className="px-4 py-3 border-b border-slate-100">
                      <div className="text-sm font-semibold text-slate-900">{item.name || 'Unnamed'}</div>
                      <div className="text-xs text-slate-500 mt-1">
                        Qty: {Number(item.quantity || 0)} | Serial: {item.serial_number || 'N/A'}
                      </div>
                      <div className="text-xs text-slate-500">
                        Status: {item.status || 'N/A'} | Location: {item.location || 'N/A'}
                      </div>
                    </div>
                  ))}
                  {consumablesLowStockList.length > 0 && (
                    <div className="px-4 pt-4 pb-1">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Consumables</p>
                    </div>
                  )}
                  {consumablesLowStockList.map((item) => (
                    <Link
                      key={item._id}
                      to="/consumables"
                      onClick={() => setShowLowStockPanel(false)}
                      className="block px-4 py-3 border-b border-slate-100 hover:bg-slate-50 transition-colors"
                    >
                      <div className="text-sm font-semibold text-slate-900">{item.name || 'Unnamed'}</div>
                      <div className="text-xs text-slate-500 mt-1">
                        Qty: {Number(item.quantity || 0)} | Min: {Number(item.min_quantity || 0)}
                        {item.location ? ` | ${item.location}` : ''}
                      </div>
                    </Link>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
