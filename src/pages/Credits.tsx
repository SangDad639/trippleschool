/**
 * /credits — user-facing credit balance + transaction history page.
 *
 * Layout matches other standalone tool pages (container + back button + title).
 * Sections:
 *   1. Hero card with current balance + CTA to /credits/topup
 *   2. Filterable transaction history table (paginated, type tabs)
 *
 * Does NOT modify any existing page or nav — added as a new Route in App.tsx.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Coins,
  CircleDollarSign,
  ArrowDownLeft,
  ArrowUpRight,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, type CreditTransactionDto } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

type FilterType = 'all' | 'credit_add' | 'credit_deduct';

const PAGE_SIZE = 25;

export default function Credits() {
  const navigate = useNavigate();
  const { user, refreshUser } = useAuth();
  const [filter, setFilter] = useState<FilterType>('all');
  const [items, setItems] = useState<CreditTransactionDto[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = async (reset = false) => {
    try {
      setLoading(true);
      const nextOffset = reset ? 0 : offset;
      const { items: rows, total: cnt } = await api.getCreditHistory({
        limit: PAGE_SIZE,
        offset: nextOffset,
        type: filter,
      });
      setItems(reset ? rows : [...items, ...rows]);
      setTotal(cnt);
      setOffset(nextOffset + rows.length);
      if (reset) await refreshUser();
    } catch (err: any) {
      toast.error(err?.message || 'โหลดประวัติไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const balance = user?.credits ?? 0;
  const totalUsed = items
    .filter((t) => t.amount < 0)
    .reduce((s, t) => s + Math.abs(t.amount), 0);

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          กลับ
        </Button>
        <Coins className="h-5 w-5 text-[#FFB300]" />
        <h1 className="text-xl md:text-2xl font-bold">เครดิตของฉัน</h1>
      </div>

      {/* Balance hero */}
      <Card className="p-6 mb-6 bg-card/40 border-[#FFB300]/15">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="text-sm text-muted-foreground mb-1">เครดิตคงเหลือ</div>
            <div className="text-4xl font-bold text-[#FFB300]">
              {balance.toLocaleString()}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              ใช้ไปแล้วในหน้านี้: {totalUsed.toLocaleString()} credits
            </div>
          </div>
          <Button
            onClick={() => navigate('/credits/topup')}
            className="bg-[#FFB300] hover:bg-[#FFB300]/85 text-black"
          >
            <CircleDollarSign className="mr-2 h-4 w-4" />
            เติมเครดิต
          </Button>
        </div>
      </Card>

      {/* History */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <h2 className="text-base font-semibold">ประวัติการใช้</h2>
          <Button variant="ghost" size="sm" onClick={() => load(true)} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} />
            รีเฟรช
          </Button>
        </div>

        <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterType)} className="mb-3">
          <TabsList>
            <TabsTrigger value="all">ทั้งหมด</TabsTrigger>
            <TabsTrigger value="credit_add">เติมเครดิต</TabsTrigger>
            <TabsTrigger value="credit_deduct">หักเครดิต</TabsTrigger>
          </TabsList>
        </Tabs>

        {items.length === 0 && !loading && (
          <div className="text-sm text-muted-foreground text-center py-8">
            ยังไม่มีรายการ
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="font-normal px-2 py-2">วันที่</th>
                <th className="font-normal px-2 py-2">ประเภท</th>
                <th className="font-normal px-2 py-2">รายละเอียด</th>
                <th className="font-normal px-2 py-2 text-right">จำนวน</th>
                <th className="font-normal px-2 py-2 text-right">คงเหลือ</th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id} className="border-b border-border/40 hover:bg-muted/20">
                  <td className="px-2 py-2 text-muted-foreground">
                    {new Date(t.createdAt).toLocaleString('th-TH', {
                      day: '2-digit',
                      month: '2-digit',
                      year: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="px-2 py-2">
                    <span className="inline-flex items-center gap-1">
                      {t.amount > 0 ? (
                        <ArrowDownLeft className="h-3 w-3 text-green-500" />
                      ) : (
                        <ArrowUpRight className="h-3 w-3 text-red-500" />
                      )}
                      <span className="text-[10px] uppercase">{t.type}</span>
                    </span>
                  </td>
                  <td className="px-2 py-2 max-w-xs truncate" title={t.description || ''}>
                    {t.description || (t.referenceType ? `${t.referenceType}:${t.referenceId}` : '—')}
                  </td>
                  <td
                    className={`px-2 py-2 text-right font-mono tabular-nums ${
                      t.amount > 0 ? 'text-green-500' : 'text-red-500'
                    }`}
                  >
                    {t.amount > 0 ? '+' : ''}
                    {t.amount.toLocaleString()}
                  </td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums text-muted-foreground">
                    {t.balanceAfter.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {items.length < total && (
          <div className="text-center mt-3">
            <Button variant="outline" size="sm" onClick={() => load(false)} disabled={loading}>
              โหลดเพิ่ม ({total - items.length} รายการ)
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
