import { Clock, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

type StepStatus = 'pending' | 'generating' | 'done' | 'failed';

interface PipelineStep {
  label: string;
  status: StepStatus;
}

interface ViralPipelineStatusProps {
  currentStep: string | null;
  taskStatus: string;
  /** Skip the image-gen step when the template pipes uploaded refs straight into video (e.g. add-character-in-movie). */
  directVideoFromRef?: boolean;
  /** Skip the concat step when the template only produces one scene. */
  singleScene?: boolean;
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

export function ViralPipelineStatus({ currentStep, taskStatus, directVideoFromRef, singleScene }: ViralPipelineStatusProps) {
  const { t } = useLanguage();

  const allSteps: PipelineStep[] = [
    { label: t('viral.stepAiPrompt'), status: getStepStatus('ai_prompt', currentStep, taskStatus) },
    { label: t('viral.stepImageGen'), status: getStepStatus('image_gen', currentStep, taskStatus) },
    { label: t('viral.stepVideoGen'), status: getStepStatus('video_gen', currentStep, taskStatus) },
    { label: t('viral.stepConcat'), status: getStepStatus('concat', currentStep, taskStatus) },
  ];

  const steps = allSteps.filter((_, i) => {
    if (i === 1 && directVideoFromRef) return false; // skip image_gen
    if (i === 3 && singleScene) return false;        // skip concat
    return true;
  });

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
