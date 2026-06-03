import { Clock, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

type StepStatus = 'pending' | 'generating' | 'done' | 'failed';

interface PipelineStep {
  label: string;
  status: StepStatus;
}

interface IdolPipelineStatusProps {
  currentStep: string | null;
  taskStatus: string;
}

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

function getStepStatus(step: string, currentStep: string | null, taskStatus: string): StepStatus {
  const steps = ['ai_prompt', 'image_gen', 'video_gen', 'concat'];
  const stepIndex = steps.indexOf(step);
  const currentIndex = currentStep ? steps.indexOf(currentStep) : -1;

  if (taskStatus === 'done') return 'done';
  if (taskStatus === 'failed') {
    if (currentIndex >= 0 && stepIndex === currentIndex) return 'failed';
    if (stepIndex < currentIndex) return 'done';
    return 'pending';
  }
  if (stepIndex < currentIndex) return 'done';
  if (stepIndex === currentIndex) return 'generating';
  return 'pending';
}

export function IdolPipelineStatus({ currentStep, taskStatus }: IdolPipelineStatusProps) {
  const { t } = useLanguage();

  const steps: PipelineStep[] = [
    { label: t('idol.stepAiPrompt'), status: getStepStatus('ai_prompt', currentStep, taskStatus) },
    { label: t('idol.stepImageGen'), status: getStepStatus('image_gen', currentStep, taskStatus) },
    { label: t('idol.stepVideoGen'), status: getStepStatus('video_gen', currentStep, taskStatus) },
    { label: t('idol.stepConcat'), status: getStepStatus('concat', currentStep, taskStatus) },
  ];

  return (
    <div className="flex items-center gap-1">
      {steps.map((step, i) => {
        const Icon = STATUS_ICONS[step.status];
        return (
          <div key={i} className="flex items-center gap-1">
            <div className="flex flex-col items-center gap-0.5">
              <Icon className={`h-4 w-4 ${STATUS_COLORS[step.status]} ${step.status === 'generating' ? 'animate-spin' : ''}`} />
              <span className={`text-[10px] ${STATUS_COLORS[step.status]}`}>{step.label}</span>
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
