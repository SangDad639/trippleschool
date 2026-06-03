import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useScheduler } from '@/contexts/SchedulerContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { api } from '@/lib/api';
import type { DashboardStats } from '@/types/scheduler';
import { Loader2, TrendingUp, CheckCircle, XCircle, Clock, Activity, AlertTriangle, BarChart3, RefreshCw } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

// Format seconds to human readable
const formatDuration = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
};

// Day names for heatmap
const DAY_NAMES_TH = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const DAY_NAMES_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const DashboardTab: React.FC = () => {
  const { channels } = useScheduler();
  const { t, language } = useLanguage();

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(7);
  const [channelId, setChannelId] = useState<number | undefined>(undefined);

  const fetchStats = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getDashboardStats(days, channelId);
      setStats(data);
    } catch (err: any) {
      console.error('Failed to fetch dashboard stats:', err);
      setError(err?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [days, channelId]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const dayNames = language === 'th' ? DAY_NAMES_TH : DAY_NAMES_EN;

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        {error ? (
          <div className="space-y-2">
            <AlertTriangle className="h-8 w-8 text-red-400 mx-auto" />
            <div className="text-red-400">{error}</div>
            <Button size="sm" variant="outline" onClick={fetchStats}>
              <RefreshCw className="h-4 w-4 mr-1" /> {t('dashboard.retry')}
            </Button>
          </div>
        ) : t('dashboard.stats.noData')}
      </div>
    );
  }

  const { summary } = stats;

  // Success rate color
  const rateColor = summary.successRate >= 90 ? 'text-green-400' :
    summary.successRate >= 70 ? 'text-yellow-400' : 'text-red-400';

  // Heatmap max for intensity
  const heatmapMax = Math.max(...stats.postingHeatmap.map(h => h.count), 1);

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          {/* Date range */}
          {[1, 7, 14, 30].map(d => (
            <Button
              key={d}
              size="sm"
              variant={days === d ? 'default' : 'outline'}
              onClick={() => setDays(d)}
              className="text-xs"
            >
              {t(`dashboard.stats.days${d}` as any)}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {/* Channel filter */}
          <select
            value={channelId || ''}
            onChange={(e) => setChannelId(e.target.value ? parseInt(e.target.value) : undefined)}
            className="h-8 text-xs bg-zinc-800 border border-zinc-700 rounded-md px-2 text-zinc-300"
          >
            <option value="">{t('dashboard.stats.allChannels')}</option>
            {channels.map(ch => (
              <option key={ch.id} value={ch.id}>{ch.name}</option>
            ))}
          </select>
          <Button size="sm" variant="ghost" onClick={fetchStats} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Section 1: KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
        <Card className="border-zinc-700/50">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 className="h-4 w-4 text-zinc-400" />
              <span className="text-xs text-zinc-500">{t('dashboard.stats.totalVideos')}</span>
            </div>
            <div className="text-2xl font-bold">{summary.total}</div>
            {summary.doneToday > 0 && (
              <div className="text-xs text-green-400 mt-1">{t('dashboard.stats.todayCount', { count: summary.doneToday })}</div>
            )}
          </CardContent>
        </Card>

        <Card className="border-zinc-700/50">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-4 w-4 text-zinc-400" />
              <span className="text-xs text-zinc-500">{t('dashboard.stats.successRate')}</span>
            </div>
            <div className={`text-2xl font-bold ${rateColor}`}>{summary.successRate}%</div>
          </CardContent>
        </Card>

        <Card className="border-blue-500/30">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <Activity className="h-4 w-4 text-blue-400" />
              <span className="text-xs text-zinc-500">{t('dashboard.stats.inProgress')}</span>
            </div>
            <div className="text-2xl font-bold text-blue-400">{summary.inProgress}</div>
          </CardContent>
        </Card>

        <Card className="border-green-500/30">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle className="h-4 w-4 text-green-400" />
              <span className="text-xs text-zinc-500">{t('dashboard.stats.completed')}</span>
            </div>
            <div className="text-2xl font-bold text-green-400">{summary.done}</div>
            {summary.doneToday > 0 && (
              <div className="text-xs text-green-400/70 mt-1">{t('dashboard.stats.todayCount', { count: summary.doneToday })}</div>
            )}
          </CardContent>
        </Card>

        <Card className="border-red-500/30">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <XCircle className="h-4 w-4 text-red-400" />
              <span className="text-xs text-zinc-500">{t('dashboard.failed')}</span>
            </div>
            <div className="text-2xl font-bold text-red-400">{summary.failed}</div>
          </CardContent>
        </Card>

        <Card className="border-zinc-700/50">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="h-4 w-4 text-zinc-400" />
              <span className="text-xs text-zinc-500">{t('dashboard.stats.avgTime')}</span>
            </div>
            <div className="text-2xl font-bold">{formatDuration(summary.avgProcessingSeconds)}</div>
          </CardContent>
        </Card>
      </div>

      {/* Section 2: Daily Output Trend */}
      <Card className="border-zinc-700/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-zinc-400">{t('dashboard.stats.dailyTrend')}</CardTitle>
        </CardHeader>
        <CardContent>
          {stats.dailyTrend.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={stats.dailyTrend} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#888' }}
                  tickFormatter={(v) => { const d = new Date(v + 'T00:00:00'); return `${d.getDate()}/${d.getMonth() + 1}`; }} />
                <YAxis tick={{ fontSize: 11, fill: '#888' }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: '#1a1a2e', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
                  labelFormatter={(v) => new Date(v + 'T00:00:00').toLocaleDateString(language === 'th' ? 'th-TH' : 'en-US', { weekday: 'short', day: 'numeric', month: 'short' })}
                />
                <Bar dataKey="done" stackId="a" fill="#22c55e" radius={[0, 0, 0, 0]} name={t('dashboard.stats.completed')} />
                <Bar dataKey="failed" stackId="a" fill="#ef4444" radius={[0, 0, 0, 0]} name={t('dashboard.failed')} />
                <Bar dataKey="pending" stackId="a" fill="#eab308" radius={[2, 2, 0, 0]} name={t('dashboard.pending')} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-center py-8 text-zinc-500 text-sm">{t('dashboard.stats.noData')}</div>
          )}
        </CardContent>
      </Card>

      {/* Section 3: Channel Performance + Platform Reliability */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Channel Performance Table */}
        <Card className="border-zinc-700/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-zinc-400">{t('dashboard.stats.channelPerformance')}</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.channelPerformance.length > 0 ? (
              <div className="space-y-2">
                {stats.channelPerformance.map((ch) => (
                  <div key={ch.channelId} className="flex items-center justify-between py-2 px-3 rounded-lg bg-zinc-800/50 hover:bg-zinc-800 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{ch.channelName}</div>
                      <div className="text-xs text-zinc-500">
                        {ch.postingService !== 'none' && <Badge variant="outline" className="text-[10px] mr-1">{ch.postingService}</Badge>}
                        {ch.lastActivity && new Date(ch.lastActivity).toLocaleDateString(language === 'th' ? 'th-TH' : 'en-US', { day: 'numeric', month: 'short' })}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-zinc-400">{ch.total}</span>
                      <span className="text-green-400">{ch.done}</span>
                      <span className="text-red-400">{ch.failed}</span>
                      <div className="w-12 bg-zinc-700 rounded-full h-1.5">
                        <div
                          className="h-1.5 rounded-full bg-green-500"
                          style={{ width: `${ch.successRate || 0}%` }}
                        />
                      </div>
                      <span className={`w-10 text-right font-mono ${ch.successRate >= 90 ? 'text-green-400' : ch.successRate >= 70 ? 'text-yellow-400' : 'text-red-400'}`}>
                        {ch.successRate}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-zinc-500 text-sm">{t('dashboard.stats.noData')}</div>
            )}
          </CardContent>
        </Card>

        {/* Platform Reliability */}
        <Card className="border-zinc-700/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-zinc-400">{t('dashboard.stats.platformReliability')}</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.platformReliability.length > 0 ? (
              <ResponsiveContainer width="100%" height={Math.max(stats.platformReliability.length * 45, 150)}>
                <BarChart data={stats.platformReliability} layout="vertical" margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#888' }} allowDecimals={false} />
                  <YAxis type="category" dataKey="platform" tick={{ fontSize: 12, fill: '#ccc' }} width={80}
                    tickFormatter={(v) => v.charAt(0).toUpperCase() + v.slice(1)} />
                  <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid #333', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="success" stackId="a" fill="#22c55e" name={t('dashboard.stats.success')} />
                  <Bar dataKey="failed" stackId="a" fill="#ef4444" name={t('dashboard.failed')} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center py-8 text-zinc-500 text-sm">{t('dashboard.stats.noData')}</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Section 4: Heatmap + Top Failures */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Posting Heatmap */}
        <Card className="border-zinc-700/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-zinc-400">{t('dashboard.stats.postingHeatmap')}</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.postingHeatmap.length > 0 ? (
              <div className="space-y-1">
                {/* Hour labels */}
                <div className="flex gap-[2px] ml-8">
                  {Array.from({ length: 24 }, (_, i) => (
                    <div key={i} className="flex-1 text-center text-[9px] text-zinc-600">
                      {i % 3 === 0 ? i : ''}
                    </div>
                  ))}
                </div>
                {/* Grid rows */}
                {[0, 1, 2, 3, 4, 5, 6].map(dow => (
                  <div key={dow} className="flex items-center gap-[2px]">
                    <div className="w-8 text-[10px] text-zinc-500 text-right pr-1">{dayNames[dow]}</div>
                    {Array.from({ length: 24 }, (_, hour) => {
                      const cell = stats.postingHeatmap.find(h => h.dayOfWeek === dow && h.hour === hour);
                      const intensity = cell ? cell.count / heatmapMax : 0;
                      return (
                        <div
                          key={hour}
                          className="flex-1 aspect-square rounded-[2px] transition-colors"
                          style={{
                            backgroundColor: intensity > 0
                              ? `rgba(99, 102, 241, ${0.15 + intensity * 0.85})`
                              : 'rgba(255,255,255,0.03)',
                          }}
                          title={`${dayNames[dow]} ${hour}:00 — ${cell?.count || 0} posts`}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-zinc-500 text-sm">{t('dashboard.stats.noData')}</div>
            )}
          </CardContent>
        </Card>

        {/* Top Failures */}
        <Card className="border-zinc-700/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-zinc-400">{t('dashboard.stats.topFailures')}</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.topErrors.length > 0 ? (
              <div className="space-y-2">
                {stats.topErrors.map((err, i) => (
                  <div key={i} className="flex items-start gap-2 py-2 px-3 rounded-lg bg-zinc-800/50">
                    <AlertTriangle className="h-3.5 w-3.5 text-red-400 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-zinc-300 break-words line-clamp-2">{err.error}</div>
                      <div className="text-[10px] text-zinc-600 mt-1">
                        {t('dashboard.stats.times', { count: err.count })}
                        {err.lastOccurrence && ` · ${new Date(err.lastOccurrence).toLocaleDateString(language === 'th' ? 'th-TH' : 'en-US', { day: 'numeric', month: 'short' })}`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-zinc-500 text-sm">
                <CheckCircle className="h-8 w-8 text-green-500/30 mx-auto mb-2" />
                <div>{t('dashboard.noErrors')}</div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Section 5: Pipeline Stage Timing */}
      <Card className="border-zinc-700/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-zinc-400">{t('dashboard.stats.pipelineTiming')}</CardTitle>
        </CardHeader>
        <CardContent>
          {(stats.pipelineTiming.avgGenerationSeconds > 0 || stats.pipelineTiming.avgCaptioningSeconds > 0 || stats.pipelineTiming.avgPostingSeconds > 0) ? (
            <div className="space-y-3">
              {[
                { label: t('dashboard.stats.generation'), value: stats.pipelineTiming.avgGenerationSeconds, color: 'bg-blue-500' },
                { label: t('dashboard.stats.captioning'), value: stats.pipelineTiming.avgCaptioningSeconds, color: 'bg-purple-500' },
                { label: t('dashboard.stats.posting'), value: stats.pipelineTiming.avgPostingSeconds, color: 'bg-green-500' },
              ].map((stage) => {
                const totalTime = stats.pipelineTiming.avgGenerationSeconds + stats.pipelineTiming.avgCaptioningSeconds + stats.pipelineTiming.avgPostingSeconds;
                const pct = totalTime > 0 ? (stage.value / totalTime) * 100 : 0;
                return (
                  <div key={stage.label} className="flex items-center gap-3">
                    <div className="w-24 text-xs text-zinc-400">{stage.label}</div>
                    <div className="flex-1 bg-zinc-800 rounded-full h-5 relative overflow-hidden">
                      <div
                        className={`h-full rounded-full ${stage.color} transition-all`}
                        style={{ width: `${Math.max(pct, 2)}%` }}
                      />
                    </div>
                    <div className="w-16 text-xs text-zinc-300 text-right font-mono">{formatDuration(stage.value)}</div>
                  </div>
                );
              })}
              <div className="text-xs text-zinc-600 text-right">
                {t('dashboard.total')}: {formatDuration(stats.pipelineTiming.avgGenerationSeconds + stats.pipelineTiming.avgCaptioningSeconds + stats.pipelineTiming.avgPostingSeconds)}
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-zinc-500 text-sm">{t('dashboard.stats.noData')}</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default DashboardTab;
