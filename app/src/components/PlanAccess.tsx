import { useEffect, useState } from 'react';
import { openPlans,openSignIn } from '@/lib/subscription';
import { useAppContext } from '@/contexts/AppContext';
import { api, type SignalTrackRecordSummary } from '@/services/api';
import SignalTrackRecord from '@/components/SignalTrackRecord';
import { LockKeyhole } from 'lucide-react';
export default function PlanAccess({ title, showTrackRecord = false }: { title: string; showTrackRecord?: boolean }) {
  const { user } = useAppContext();
  const [summary, setSummary] = useState<SignalTrackRecordSummary | null>(null);

  useEffect(() => {
    if (!showTrackRecord) return;
    let active = true;
    void api.signals.trackRecord().then((res) => {
      if (active && !res._offline && res.data.summary) {
        setSummary(res.data.summary);
      }
    }).catch(() => {});
    return () => { active = false; };
  }, [showTrackRecord]);

  return (
    <div className="space-y-4">
      <section className="glass-card space-y-3 p-5">
        <h3 className="flex items-center gap-2 font-semibold"><LockKeyhole className="h-4 w-4 text-primary" />{title}</h3>
        <p className="text-sm text-muted-foreground">Available with an active Pro or VIP plan. Access is verified by the server for your account.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={openPlans} className="rounded-lg border px-3 py-2 text-xs">View plans</button>
          {!user && <button type="button" onClick={openSignIn} className="rounded-lg bg-primary px-3 py-2 text-xs text-primary-foreground">Sign in</button>}
        </div>
      </section>
      {showTrackRecord && summary && <SignalTrackRecord summary={summary} publicPreview />}
    </div>
  );
}
