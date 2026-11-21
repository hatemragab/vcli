import { ApplicationError } from '../../core/errors/application-error.js';
import type { PushDestination, PushState } from './push.entity.js';
export function sameDestination(
  left: PushDestination,
  right: PushDestination,
): boolean {
  return (
    left.id === right.id &&
    left.generation === right.generation &&
    left.accountId === right.accountId &&
    left.sessionId === right.sessionId &&
    left.installationId === right.installationId &&
    left.installationGeneration === right.installationGeneration &&
    left.scope === right.scope &&
    left.environment === right.environment &&
    left.provider === right.provider &&
    left.purpose === right.purpose &&
    left.tokenHash === right.tokenHash
  );
}
export function registerDestination(
  state: PushState,
  destination: PushDestination,
): PushState {
  const binding = (entry: PushDestination) =>
    entry.installationId === destination.installationId &&
    entry.scope === destination.scope &&
    entry.environment === destination.environment;
  if (
    destination.installationGeneration < 1 ||
    state.destinations.some(
      (entry) =>
        binding(entry) &&
        (entry.installationGeneration > destination.installationGeneration ||
          (entry.installationGeneration ===
            destination.installationGeneration &&
            entry.accountId !== destination.accountId)),
    )
  )
    throw new ApplicationError('PUSH_BINDING_STALE', 409);
  if (
    state.destinations.some(
      (entry) =>
        entry.id === destination.id &&
        (!binding(entry) || entry.accountId !== destination.accountId),
    )
  )
    throw new ApplicationError('PUSH_DESTINATION_CONFLICT', 409);
  const existing = state.destinations.find(
    (entry) =>
      binding(entry) &&
      entry.accountId === destination.accountId &&
      entry.installationGeneration === destination.installationGeneration &&
      entry.purpose === destination.purpose,
  );
  const retained = state.destinations.filter(
    (entry) =>
      !(
        binding(entry) &&
        (entry.installationGeneration < destination.installationGeneration ||
          entry.purpose === destination.purpose)
      ),
  );
  // One token has one purpose/installation/owner in a provider+app+environment.
  if (
    retained.some(
      (entry) =>
        entry.provider === destination.provider &&
        entry.scope === destination.scope &&
        entry.environment === destination.environment &&
        entry.tokenHash === destination.tokenHash,
    )
  )
    throw new ApplicationError('PUSH_TOKEN_ALREADY_BOUND', 409);
  if (
    retained.length >= 1024 ||
    retained.filter((entry) => entry.accountId === destination.accountId)
      .length >= 32
  )
    throw new ApplicationError('PUSH_DESTINATION_LIMIT', 409);
  return {
    revision: state.revision + 1,
    destinations: [
      ...retained,
      { ...destination, id: existing?.id ?? destination.id },
    ],
  };
}
export function removeDestination(
  state: PushState,
  destination: PushDestination,
): PushState {
  return {
    revision: state.revision + 1,
    destinations: state.destinations.filter(
      (entry) => !sameDestination(entry, destination),
    ),
  };
}
