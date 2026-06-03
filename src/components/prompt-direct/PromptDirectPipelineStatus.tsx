import { Clock, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

type StepStatus = 'pending' | 'generating' | 'done' | 'failed';

const STATUS_ICONS: Record<StepStatus, React.ElementType> = {
  pending: Clock,
  generating: Loader2,
  done: CheckCircle2,
  failed: AlertCircle,
};

const STATUS_COLORS: Record<StepStatus, string> = {
  pending: 'text-zinc-500',
  generating: 'text-yellow-400',
  done: 'text-green-400',
  failed: 'text-red-400',
};

const LINE_COLORS: Record<StepStatus, string> = {
  pending: 'bg-zinc-700',
  generating: 'bg-yellow-400/50',
  done: 'bg-green-400/50',
  failed: 'bg-red-400/50',
};

interface PromptDirectPipelineStatusProps {
  task: any; // { status, logs, error, video_url }
}

/**
 * Detect current step from latest log emoji.
 * Steps: 1=send_prompt → 2=generate (includes save phase)
 */
function detectCurrentStep(task: any): number {
  const logs = task.logs || [];
  if (logs.length === 0) return 0;

  for (let i = logs.length - 1; i >= 0; i--) {
    const emoji = logs[i].emoji;
    // Step 2: generating + save phase (KIE polling, watermark, dropbox upload)
    if (emoji === '⏳' || emoji === '📡' || emoji === '🔗' || emoji === '📦' || emoji === '💧' || emoji === '✅' || emoji === '🎉') return 2;
    // Step 1: send prompt / starting
    if (emoji === '📤' || emoji === '🚀') return 1;
  }
  return 0;
}

function getStepStatus(stepIndex: number, currentStep: number, taskStatus: string): StepStatus {
  if (taskStatus === 'done') return 'done';
  if (taskStatus === 'failed') {
    if (stepIndex === currentStep) return 'failed';
    if (stepIndex < currentStep) return 'done';
    return 'pending';
  }
  if (taskStatus === 'pending') return 'pending';
  // generating
  if (stepIndex < currentStep) return 'done';
  if (stepIndex === currentStep) return 'generating';
  return 'pending';
}

export function PromptDirectPipelineStatus({ task }: PromptDirectPipelineStatusProps) {
  const { language } = useLanguage();
  const l = (th: string, en: string) => language === 'th' ? th : en;

  const currentStep = detectCurrentStep(task);

  const steps = [
    { label: l('ส่ง Prompt', 'Send Prompt'), status: getStepStatus(1, currentStep, task.status) },
    { label: l('สร้างวิดีโอ', 'Generate'), status: getStepStatus(2, currentStep, task.status) },
  ];

  return (
    <div className="flex items-center gap-1">
      {steps.map((step, i) => {
        const Icon = STATUS_ICONS[step.status];
        return (
          <div key={i} className="flex items-center gap-1">
            <div className="flex flex-col items-center gap-0.5">
              <Icon className={`h-4 w-4 ${STATUS_COLORS[step.status]} ${step.status === 'generating' ? 'animate-spin' : ''}`} />
              <span className={`text-[10px] ${STATUS_COLORS[step.status]} text-center whitespace-nowrap`}>{step.label}</span>
            </div>
            {i < steps.length - 1 && (
              <div className={`w-6 h-0.5 ${LINE_COLORS[step.status]} mt-[-10px]`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
