"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Image from "next/image";
import QuotaTable from "./QuotaTable";
import { parseQuotaData, calculatePercentage } from "./utils";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import { USAGE_SUPPORTED_PROVIDERS } from "@/shared/constants/providers";

const REFRESH_INTERVAL_MS = 60000; // 60 seconds
const COMPACT_MODE_STORAGE_KEY = "provider-limits-compact-mode";

export default function ProviderLimits() {
  const [connections, setConnections] = useState([]);
  const [quotaData, setQuotaData] = useState({});
  const [loading, setLoading] = useState({});
  const [errors, setErrors] = useState({});
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [compactMode, setCompactMode] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const [connectionsLoading, setConnectionsLoading] = useState(true);

  const intervalRef = useRef(null);
  const countdownRef = useRef(null);

  // Restore compact mode preference
  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const saved = window.localStorage.getItem(COMPACT_MODE_STORAGE_KEY);
      if (saved === "true") setCompactMode(true);
    } catch {
      // Ignore storage access issues
    }
  }, []);

  // Persist compact mode preference
  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      window.localStorage.setItem(COMPACT_MODE_STORAGE_KEY, String(compactMode));
    } catch {
      // Ignore storage access issues
    }
  }, [compactMode]);

  // Fetch all provider connections
  const fetchConnections = useCallback(async () => {
    try {
      const response = await fetch("/api/providers/client");
      if (!response.ok) throw new Error("Failed to fetch connections");
      
      const data = await response.json();
      const connectionList = data.connections || [];
      setConnections(connectionList);
      return connectionList;
    } catch (error) {
      console.error("Error fetching connections:", error);
      setConnections([]);
      return [];
    }
  }, []);

  // Fetch quota for a specific connection
  const fetchQuota = useCallback(async (connectionId, provider) => {
    setLoading((prev) => ({ ...prev, [connectionId]: true }));
    setErrors((prev) => ({ ...prev, [connectionId]: null }));

    try {
      console.log(`[ProviderLimits] Fetching quota for ${provider} (${connectionId})`);
      const response = await fetch(`/api/usage/${connectionId}`);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.error || response.statusText;
        
        // Handle different error types gracefully
        if (response.status === 404) {
          // Connection not found - skip silently
          console.warn(`[ProviderLimits] Connection not found for ${provider}, skipping`);
          return;
        }
        
        if (response.status === 401) {
          // Auth error - show message instead of throwing
          console.warn(`[ProviderLimits] Auth error for ${provider}:`, errorMsg);
          setQuotaData((prev) => ({
            ...prev,
            [connectionId]: {
              quotas: [],
              message: errorMsg,
            },
          }));
          return;
        }
        
        throw new Error(`HTTP ${response.status}: ${errorMsg}`);
      }

      const data = await response.json();
      console.log(`[ProviderLimits] Got quota for ${provider}:`, data);
      
      // Parse quota data using provider-specific parser
      const parsedQuotas = parseQuotaData(provider, data);
      
      setQuotaData((prev) => ({
        ...prev,
        [connectionId]: {
          quotas: parsedQuotas,
          plan: data.plan || null,
          message: data.message || null,
          raw: data,
        },
      }));
    } catch (error) {
      console.error(`[ProviderLimits] Error fetching quota for ${provider} (${connectionId}):`, error);
      setErrors((prev) => ({
        ...prev,
        [connectionId]: error.message || "Failed to fetch quota",
      }));
    } finally {
      setLoading((prev) => ({ ...prev, [connectionId]: false }));
    }
  }, []);

  // Refresh quota for a specific provider
  const refreshProvider = useCallback(
    async (connectionId, provider) => {
      await fetchQuota(connectionId, provider);
      setLastUpdated(new Date());
    },
    [fetchQuota]
  );

  // Refresh all providers
  const refreshAll = useCallback(async () => {
    if (refreshingAll) return;

    setRefreshingAll(true);
    setCountdown(60);

    try {
      const conns = await fetchConnections();
      
      // Filter only supported OAuth providers
      const oauthConnections = conns.filter(
        (conn) => USAGE_SUPPORTED_PROVIDERS.includes(conn.provider) && conn.authType === "oauth"
      );
      
      // Fetch quota for supported OAuth connections only
      await Promise.all(
        oauthConnections.map((conn) => fetchQuota(conn.id, conn.provider))
      );

      setLastUpdated(new Date());
    } catch (error) {
      console.error("Error refreshing all providers:", error);
    } finally {
      setRefreshingAll(false);
    }
  }, [refreshingAll, fetchConnections, fetchQuota]);

  // Initial load: fetch connections first so cards render immediately, then fetch quotas
  useEffect(() => {
    const initializeData = async () => {
      setConnectionsLoading(true);
      const conns = await fetchConnections();
      setConnectionsLoading(false);

      const oauthConnections = conns.filter(
        (conn) => USAGE_SUPPORTED_PROVIDERS.includes(conn.provider) && conn.authType === "oauth"
      );

      // Mark all as loading before fetching
      const loadingState = {};
      oauthConnections.forEach((conn) => { loadingState[conn.id] = true; });
      setLoading(loadingState);

      await Promise.all(
        oauthConnections.map((conn) => fetchQuota(conn.id, conn.provider))
      );
      setLastUpdated(new Date());
    };

    initializeData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh interval
  useEffect(() => {
    if (!autoRefresh) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
      return;
    }

    // Main refresh interval
    intervalRef.current = setInterval(() => {
      refreshAll();
    }, REFRESH_INTERVAL_MS);

    // Countdown interval
    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) return 60;
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [autoRefresh, refreshAll]);

  // Pause auto-refresh when tab is hidden (Page Visibility API)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        if (countdownRef.current) {
          clearInterval(countdownRef.current);
          countdownRef.current = null;
        }
      } else if (autoRefresh) {
        // Resume auto-refresh when tab becomes visible
        intervalRef.current = setInterval(refreshAll, REFRESH_INTERVAL_MS);
        countdownRef.current = setInterval(() => {
          setCountdown((prev) => (prev <= 1 ? 60 : prev - 1));
        }, 1000);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [autoRefresh, refreshAll]);

  // Format last updated time
  const formatLastUpdated = useCallback(() => {
    if (!lastUpdated) return "Never";

    const now = new Date();
    const diffMs = now - lastUpdated;
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) return `${diffDays}d ago`;
    if (diffHours > 0) return `${diffHours}h ago`;
    if (diffMinutes > 0) return `${diffMinutes}m ago`;
    return "Just now";
  }, [lastUpdated]);

  // Filter only supported providers
  const filteredConnections = connections.filter((conn) =>
    USAGE_SUPPORTED_PROVIDERS.includes(conn.provider) && conn.authType === "oauth"
  );

  // Sort providers by USAGE_SUPPORTED_PROVIDERS order, then alphabetically
  const sortedConnections = [...filteredConnections].sort((a, b) => {
    const orderA = USAGE_SUPPORTED_PROVIDERS.indexOf(a.provider);
    const orderB = USAGE_SUPPORTED_PROVIDERS.indexOf(b.provider);
    if (orderA !== orderB) return orderA - orderB;
    return a.provider.localeCompare(b.provider);
  });

  // Calculate summary stats
  const totalProviders = sortedConnections.length;
  const activeWithLimits = Object.values(quotaData).filter(
    (data) => data?.quotas?.length > 0
  ).length;
  
  // Count low quotas (remaining < 30%)
  const lowQuotasCount = Object.values(quotaData).reduce((count, data) => {
    if (!data?.quotas) return count;
    
    const hasLowQuota = data.quotas.some((quota) => {
      const percentage = calculatePercentage(quota.used, quota.total);
      return percentage < 30 && quota.total > 0;
    });
    
    return count + (hasLowQuota ? 1 : 0);
  }, 0);

  // Empty state
  if (!connectionsLoading && sortedConnections.length === 0) {
    return (
      <Card padding="lg">
        <div className="text-center py-12">
          <span className="material-symbols-outlined text-[64px] text-text-muted opacity-20">
            cloud_off
          </span>
          <h3 className="mt-4 text-lg font-semibold text-text-primary">
            No Providers Connected
          </h3>
          <p className="mt-2 text-sm text-text-muted max-w-md mx-auto">
            Connect to providers with OAuth to track your API quota limits and usage.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className={compactMode ? "space-y-4" : "space-y-6"}>
      {/* Header Controls */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-xl font-semibold text-text-primary">
            Provider Limits
          </h2>
          <span className="text-sm text-text-muted">
            Last updated: {formatLastUpdated()}
          </span>
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <span>{totalProviders} providers</span>
            <span>•</span>
            <span>{activeWithLimits} with quota</span>
            <span>•</span>
            <span>{lowQuotasCount} low</span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Compact mode toggle */}
          <button
            onClick={() => setCompactMode((prev) => !prev)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            title={compactMode ? "Disable compact mode" : "Enable compact mode"}
          >
            <span
              className={`material-symbols-outlined text-[18px] ${
                compactMode ? "text-primary" : "text-text-muted"
              }`}
            >
              {compactMode ? "view_agenda" : "view_stream"}
            </span>
            <span className="text-sm text-text-primary">Compact</span>
          </button>

          {/* Auto-refresh toggle */}
          <button
            onClick={() => setAutoRefresh((prev) => !prev)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            title={autoRefresh ? "Disable auto-refresh" : "Enable auto-refresh"}
          >
            <span
              className={`material-symbols-outlined text-[18px] ${
                autoRefresh ? "text-primary" : "text-text-muted"
              }`}
            >
              {autoRefresh ? "toggle_on" : "toggle_off"}
            </span>
            <span className="text-sm text-text-primary">Auto-refresh</span>
            {autoRefresh && (
              <span className="text-xs text-text-muted">({countdown}s)</span>
            )}
          </button>

          {/* Refresh all button */}
          <Button
            variant="secondary"
            size="md"
            icon="refresh"
            onClick={refreshAll}
            disabled={refreshingAll}
            loading={refreshingAll}
          >
            Refresh All
          </Button>
        </div>
      </div>

      {/* Provider Cards Grid */}
      <div className={compactMode ? "grid grid-cols-1 md:grid-cols-2 gap-3 items-start" : "flex flex-col gap-4"}>
        {sortedConnections.map((conn) => {
          const quota = quotaData[conn.id];
          const isLoading = loading[conn.id];
          const error = errors[conn.id];

          return (
            <div key={conn.id} className={compactMode ? "h-full" : ""}>
              <Card padding="none" className={compactMode ? "h-full" : undefined}>
              <div className={`${compactMode ? "p-3" : "p-6"} border-b border-black/10 dark:border-white/10`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`${compactMode ? "w-8 h-8 rounded-md" : "w-10 h-10 rounded-lg"} flex items-center justify-center overflow-hidden shrink-0`}>
                      <Image
                        src={`/providers/${conn.provider}.png`}
                        alt={conn.provider}
                        width={compactMode ? 32 : 40}
                        height={compactMode ? 32 : 40}
                        className="object-contain"
                        sizes={compactMode ? "32px" : "40px"}
                      />
                    </div>
                    <div className="min-w-0">
                      <h3 className={`${compactMode ? "text-sm" : "text-base"} font-semibold text-text-primary capitalize truncate`}>
                        {conn.provider}
                      </h3>
                      {conn.name && (
                        <p className={`${compactMode ? "text-xs" : "text-sm"} text-text-muted truncate`}>
                          {conn.name}
                        </p>
                      )}
                    </div>
                  </div>
                  
                  <button
                    onClick={() => refreshProvider(conn.id, conn.provider)}
                    disabled={isLoading}
                    className={`${compactMode ? "p-1.5" : "p-2"} rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-50 shrink-0`}
                    title="Refresh quota"
                  >
                    <span className={`material-symbols-outlined ${compactMode ? "text-[18px]" : "text-[20px]"} text-text-muted ${isLoading ? "animate-spin" : ""}`}>
                      refresh
                    </span>
                  </button>
                </div>
              </div>

              <div className={compactMode ? "p-3" : "p-6"}>
                {isLoading ? (
                  <div className={`text-center ${compactMode ? "py-5" : "py-8"} text-text-muted`}>
                    <span className={`material-symbols-outlined ${compactMode ? "text-[24px]" : "text-[32px]"} animate-spin`}>
                      progress_activity
                    </span>
                  </div>
                ) : error ? (
                  <div className={`text-center ${compactMode ? "py-4" : "py-8"}`}>
                    <span className={`material-symbols-outlined ${compactMode ? "text-[24px]" : "text-[32px]"} text-red-500`}>
                      error
                    </span>
                    <p className={`mt-2 ${compactMode ? "text-xs" : "text-sm"} text-text-muted`}>{error}</p>
                  </div>
                ) : quota?.message ? (
                  <div className={`text-center ${compactMode ? "py-4" : "py-8"}`}>
                    <p className={`${compactMode ? "text-xs" : "text-sm"} text-text-muted`}>{quota.message}</p>
                  </div>
                ) : (
                  <QuotaTable quotas={quota?.quotas} compact={compactMode} />
                )}
              </div>
              </Card>
            </div>
          );
        })}
      </div>
    </div>
  );
}
