import { ApplicationError } from '../../core/errors/application-error.js';
import type { PushDestination, PushState } from './push.entity.js';

export function registerDestination(
  state: PushState,
  destination: PushDestination,
): PushState {
  const retained = state.destinations.filter(
    (entry) =>
      !(
        entry.installationId === destination.installationId &&
        entry.scope === destination.scope &&
        (entry.purpose === destination.purpose ||
          entry.accountId !== destination.accountId)
      ),
  );
  if (
    retained.some(
      (entry) =>
        entry.tokenHash === destination.tokenHash &&
        entry.provider === destination.provider &&
        entry.scope === destination.scope &&
        (entry.installationId !== destination.installationId ||
          entry.accountId !== destination.accountId),
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
    destinations: [...retained, destination],
  };
}

export function removeDestination(
  state: PushState,
  accountId: string,
  installationId: string,
  id: string,
  generation: string,
): PushState {
  return {
    revision: state.revision + 1,
    destinations: state.destinations.filter(
      (entry) =>
        !(
          entry.id === id &&
          entry.generation === generation &&
          entry.accountId === accountId &&
          entry.installationId === installationId
        ),
    ),
  };
}
