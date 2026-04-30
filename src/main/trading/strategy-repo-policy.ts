import { DEFAULT_STRATEGY_PROFILE, type StrategyProfile } from '@shared/contracts';

type StrategyAutoControlsLike = Pick<
  StrategyProfile,
  'autoBuyEnabled' | 'autoBuyOrderType' | 'autoSellEnabled' | 'autoSellOrderType'
>;

export function isUnsafeDefaultAutoProfile(profile: StrategyProfile): boolean {
  if (!profile.autoBuyEnabled || !profile.autoSellEnabled) return false;
  const disabled = {
    ...profile,
    autoBuyEnabled: false,
    autoSellEnabled: false,
  };
  return JSON.stringify(disabled) === JSON.stringify(DEFAULT_STRATEGY_PROFILE);
}

export function hasSameAutoControls(
  profile: StrategyProfile,
  controls: StrategyAutoControlsLike,
): boolean {
  return (
    profile.autoBuyEnabled === controls.autoBuyEnabled &&
    profile.autoBuyOrderType === controls.autoBuyOrderType &&
    profile.autoSellEnabled === controls.autoSellEnabled &&
    profile.autoSellOrderType === controls.autoSellOrderType
  );
}
