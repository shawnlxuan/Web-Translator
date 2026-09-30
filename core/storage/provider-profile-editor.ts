import type { ProviderId, ProviderProfile } from '../../shared/types';
import {
  normalizeProviderName,
  PROVIDER_PRESETS,
} from '../../shared/provider-presets';

export function renameCustomProfile(
  profiles: readonly ProviderProfile[],
  id: ProviderId,
  nextName: string,
): ProviderProfile[] {
  const profile = profiles.find((candidate) => candidate.id === id);
  if (!profile) throw new Error('Provider profile not found.');
  if (profile.kind !== 'custom') throw new Error('Built-in providers cannot be renamed.');

  const name = normalizeProviderName(nextName);
  if (!name) throw new Error('Provider name must not be empty.');
  const key = name.toLowerCase();
  if (profiles.some((candidate) => (
    candidate.id !== id
    && normalizeProviderName(candidate.name).toLowerCase() === key
  ))) {
    throw new Error('Provider name must be unique.');
  }

  return profiles.map((candidate) => (
    candidate.id === id ? { ...candidate, name } : candidate
  ));
}

export function deleteCustomProfile(
  profiles: readonly ProviderProfile[],
  id: ProviderId,
  activeProviderId: ProviderId,
): { profiles: ProviderProfile[]; activeProviderId: ProviderId } {
  const profile = profiles.find((candidate) => candidate.id === id);
  if (!profile) throw new Error('Provider profile not found.');
  if (profile.kind !== 'custom') throw new Error('Built-in providers cannot be deleted.');

  return {
    profiles: profiles.filter((candidate) => candidate.id !== id),
    activeProviderId: activeProviderId === id
      ? 'builtin:openai'
      : activeProviderId,
  };
}

export function resetBuiltinProfile(profile: ProviderProfile): ProviderProfile {
  if (profile.kind !== 'builtin' || !profile.preset) {
    throw new Error('Custom providers do not have official defaults.');
  }
  const preset = PROVIDER_PRESETS[profile.preset];
  return {
    ...profile,
    name: preset.name,
    protocol: preset.protocol,
    endpoint: preset.endpoint,
    model: preset.model,
    preset: preset.id,
  };
}

export function validateProviderProfileNames(
  profiles: readonly ProviderProfile[],
): string | null {
  const names = new Set<string>();
  for (const profile of profiles) {
    const name = normalizeProviderName(profile.name);
    if (!name) return 'Provider name must not be empty.';
    const key = name.toLowerCase();
    if (names.has(key)) return 'Provider name must be unique.';
    names.add(key);
  }
  return null;
}
