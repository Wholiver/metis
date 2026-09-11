import type { ReactNode } from 'react';
import { Box, KeyRound, LogIn } from 'lucide-react';

import amazonBedrock from '@lobehub/icons-static-svg/icons/bedrock.svg?raw';
import anthropic from '@lobehub/icons-static-svg/icons/anthropic.svg?raw';
import antGroup from '@lobehub/icons-static-svg/icons/antgroup.svg?raw';
import azure from '@lobehub/icons-static-svg/icons/azure.svg?raw';
import baseten from '@lobehub/icons-static-svg/icons/baseten.svg?raw';
import cerebras from '@lobehub/icons-static-svg/icons/cerebras.svg?raw';
import cloudflare from '@lobehub/icons-static-svg/icons/cloudflare.svg?raw';
import cohere from '@lobehub/icons-static-svg/icons/cohere.svg?raw';
import deepseek from '@lobehub/icons-static-svg/icons/deepseek.svg?raw';
import fireworks from '@lobehub/icons-static-svg/icons/fireworks.svg?raw';
import githubCopilot from '@lobehub/icons-static-svg/icons/githubcopilot.svg?raw';
import google from '@lobehub/icons-static-svg/icons/google.svg?raw';
import googleVertex from '@lobehub/icons-static-svg/icons/vertexai.svg?raw';
import groq from '@lobehub/icons-static-svg/icons/groq.svg?raw';
import huggingface from '@lobehub/icons-static-svg/icons/huggingface.svg?raw';
import kimi from '@lobehub/icons-static-svg/icons/kimi.svg?raw';
import minimax from '@lobehub/icons-static-svg/icons/minimax.svg?raw';
import mistral from '@lobehub/icons-static-svg/icons/mistral.svg?raw';
import moonshot from '@lobehub/icons-static-svg/icons/moonshot.svg?raw';
import nvidia from '@lobehub/icons-static-svg/icons/nvidia.svg?raw';
import ollama from '@lobehub/icons-static-svg/icons/ollama.svg?raw';
import openai from '@lobehub/icons-static-svg/icons/openai.svg?raw';
import opencode from '@lobehub/icons-static-svg/icons/opencode.svg?raw';
import openrouter from '@lobehub/icons-static-svg/icons/openrouter.svg?raw';
import qwen from '@lobehub/icons-static-svg/icons/qwen.svg?raw';
import together from '@lobehub/icons-static-svg/icons/together.svg?raw';
import vercel from '@lobehub/icons-static-svg/icons/vercel.svg?raw';
import xai from '@lobehub/icons-static-svg/icons/xai.svg?raw';
import xiaomi from '@lobehub/icons-static-svg/icons/xiaomimimo.svg?raw';
import zai from '@lobehub/icons-static-svg/icons/zai.svg?raw';

type AuthMethod = 'api_key' | 'oauth';

type ProviderIconProps = {
  providerId: string;
  authMethods?: AuthMethod[];
  className?: string;
};

const DEFAULT_CLASS = 'h-3.5 w-3.5 shrink-0';

/** Monochrome marks from @lobehub/icons-static-svg (fill=currentColor). */
const BRAND_ICON_SVG: Record<string, string> = {
  anthropic,
  openai,
  google,
  'google-vertex': googleVertex,
  openrouter,
  deepseek,
  groq,
  ollama,
  'amazon-bedrock': amazonBedrock,
  cohere,
  'ant-ling': antGroup,
  'azure-openai-responses': azure,
  baseten,
  cerebras,
  'cloudflare-ai-gateway': cloudflare,
  'cloudflare-workers-ai': cloudflare,
  fireworks,
  huggingface,
  'kimi-coding': kimi,
  mistral,
  minimax,
  'minimax-cn': minimax,
  moonshotai: moonshot,
  'moonshotai-cn': moonshot,
  nvidia,
  opencode,
  'opencode-go': opencode,
  'github-copilot': githubCopilot,
  'qwen-token-plan': qwen,
  'qwen-token-plan-cn': qwen,
  'qwen-token-plan-individual': qwen,
  together,
  'vercel-ai-gateway': vercel,
  xai,
  zai,
  'zai-coding-cn': zai,
  xiaomi,
  'xiaomi-token-plan-cn': xiaomi,
  'xiaomi-token-plan-ams': xiaomi,
  'xiaomi-token-plan-sgp': xiaomi,
};

const BRAND_ALIASES: Record<string, string> = {
  gemini: 'google',
  'openai-codex': 'openai',
  'openai-responses': 'openai',
  azure: 'azure-openai-responses',
  'azure-openai': 'azure-openai-responses',
  bedrock: 'amazon-bedrock',
  amazon: 'amazon-bedrock',
  cloudflare: 'cloudflare-ai-gateway',
  kimi: 'kimi-coding',
  moonshot: 'moonshotai',
  'vertex-ai': 'google-vertex',
  vertexai: 'google-vertex',
  huggingfacehub: 'huggingface',
  hf: 'huggingface',
  qwen: 'qwen-token-plan',
};

function resolveBrandId(providerId: string): string | null {
  const mapped = BRAND_ICON_SVG[providerId] ? providerId : BRAND_ALIASES[providerId];
  if (mapped && BRAND_ICON_SVG[mapped]) return mapped;
  return null;
}

export function hasProviderBrandIcon(providerId: string): boolean {
  if (providerId === '__custom__' || providerId.startsWith('custom-')) return false;
  return resolveBrandId(providerId) !== null;
}

function BrandMark({ providerId, svg, className }: { providerId: string; svg: string; className?: string }) {
  return (
    <span
      role="img"
      aria-hidden="true"
      data-provider-icon={providerId}
      className={`inline-flex items-center justify-center [&>svg]:h-full [&>svg]:w-full ${className ?? DEFAULT_CLASS}`}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export default function ProviderIcon({ providerId, authMethods = [], className }: ProviderIconProps): ReactNode {
  const mergedClass = className ?? DEFAULT_CLASS;

  if (providerId === '__custom__' || providerId.startsWith('custom-')) {
    return <Box data-provider-icon={providerId} className={mergedClass} />;
  }

  const brandId = resolveBrandId(providerId);
  if (brandId) {
    return <BrandMark providerId={providerId} svg={BRAND_ICON_SVG[brandId]} className={mergedClass} />;
  }

  if (authMethods.includes('oauth')) {
    return <LogIn data-provider-icon={providerId} className={`${mergedClass} text-accent`} />;
  }

  return <KeyRound data-provider-icon={providerId} className={`${mergedClass} text-ink-3`} />;
}

export type { ProviderIconProps, AuthMethod };
