import { useLingui } from '@lingui/react/macro';
import { useLocation, useNavigate } from 'react-router-dom';
import { AppPath, SettingsPath } from 'twenty-shared/types';
import { getSettingsPath } from 'twenty-shared/utils';
import {
  IconHelpCircle,
  IconListCheck,
  IconMail,
  IconMessage,
  IconSettings,
  IconSparkles,
} from 'twenty-ui/display';
import { AnimatedExpandableContainer } from 'twenty-ui/layout';

import { currentWorkspaceMemberState } from '@/auth/states/currentWorkspaceMemberState';
import { useUnreadSmsCount } from '@/sms/hooks/useUnreadSmsCount';
import { getDocumentationUrl } from '@/support/utils/getDocumentationUrl';
import { isNavigationDrawerExpandedState } from '@/ui/navigation/states/isNavigationDrawerExpanded';
import { navigationDrawerExpandedMemorizedState } from '@/ui/navigation/states/navigationDrawerExpandedMemorizedState';
import { navigationMemorizedUrlState } from '@/ui/navigation/states/navigationMemorizedUrlState';
import { useAtomState } from '@/ui/utilities/state/jotai/hooks/useAtomState';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { useSetAtomState } from '@/ui/utilities/state/jotai/hooks/useSetAtomState';

import { NavigationDrawerAnimatedCollapseWrapper } from '@/ui/navigation/navigation-drawer/components/NavigationDrawerAnimatedCollapseWrapper';
import { NavigationDrawerItem } from '@/ui/navigation/navigation-drawer/components/NavigationDrawerItem';
import { NavigationDrawerSection } from '@/ui/navigation/navigation-drawer/components/NavigationDrawerSection';
import { NavigationDrawerSectionTitle } from '@/ui/navigation/navigation-drawer/components/NavigationDrawerSectionTitle';
import { useNavigationSection } from '@/ui/navigation/navigation-drawer/hooks/useNavigationSection';
import { isNavigationSectionOpenFamilyState } from '@/ui/navigation/navigation-drawer/states/isNavigationSectionOpenFamilyState';
import { useAtomFamilyStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomFamilyStateValue';

export const NavigationDrawerOtherSection = () => {
  const { t } = useLingui();
  const location = useLocation();
  const navigate = useNavigate();
  const currentWorkspaceMember = useAtomStateValue(currentWorkspaceMemberState);
  const [isNavigationDrawerExpanded, setIsNavigationDrawerExpanded] =
    useAtomState(isNavigationDrawerExpandedState);
  const setNavigationDrawerExpandedMemorized = useSetAtomState(
    navigationDrawerExpandedMemorizedState,
  );
  const setNavigationMemorizedUrl = useSetAtomState(
    navigationMemorizedUrlState,
  );

  const unreadSmsCount = useUnreadSmsCount();

  const { toggleNavigationSection } = useNavigationSection('Other');
  const isNavigationSectionOpen = useAtomFamilyStateValue(
    isNavigationSectionOpenFamilyState,
    'Other',
  );

  const handleSettingsClick = () => {
    setNavigationDrawerExpandedMemorized(isNavigationDrawerExpanded);
    setIsNavigationDrawerExpanded(true);
    setNavigationMemorizedUrl(location.pathname + location.search);
    navigate(getSettingsPath(SettingsPath.ProfilePage));
  };

  return (
    <NavigationDrawerSection>
      <NavigationDrawerAnimatedCollapseWrapper>
        <NavigationDrawerSectionTitle
          label={t`Other`}
          onClick={toggleNavigationSection}
          isOpen={isNavigationSectionOpen}
        />
      </NavigationDrawerAnimatedCollapseWrapper>
      <AnimatedExpandableContainer
        isExpanded={isNavigationSectionOpen}
        dimension="height"
        mode="fit-content"
        containAnimation
        initial={false}
      >
        {/* Custom (Impression fork): external link to the Daily Command Center
            triage app. External https `to` makes NavigationDrawerItem open it
            in a new tab so the CRM stays put. Re-apply on Twenty upgrades.
            Plain string (not the t`` macro): "Command Center" isn't in the
            compiled Lingui catalog, so the macro renders the message id
            ("Nf5ZtG") instead of the text. */}
        {/* eslint-disable-next-line lingui/no-unlocalized-strings */}
        <NavigationDrawerItem
          label="Command Center"
          Icon={IconListCheck}
          to="https://crm.impressionphotography.ca/command-center/"
        />
        {/* Custom (Impression fork): Feedback Board — request features / report
            bugs. Unguessable no-login URL; opens in a new tab. Plain string
            label (not the t`` macro) since it isn't in the Lingui catalog. */}
        {/* eslint-disable-next-line lingui/no-unlocalized-strings */}
        <NavigationDrawerItem
          label="Feedback"
          Icon={IconSparkles}
          to="https://crm.impressionphotography.ca/board-480d724fe05b0c3f74bc75dff25f9301/"
        />
        <NavigationDrawerItem
          label={t`Inbox`}
          Icon={IconMail}
          to={AppPath.InboxPage}
          active={location.pathname === AppPath.InboxPage}
        />
        <NavigationDrawerItem
          label={t`SMS`}
          Icon={IconMessage}
          to={AppPath.SmsInboxPage}
          active={location.pathname === AppPath.SmsInboxPage}
          count={unreadSmsCount > 0 ? unreadSmsCount : undefined}
          // The badge counts unread inbound messages, which is a different
          // metric than the conversation count shown on the SMS page header.
          // Label it explicitly so "22" can't be mistaken for conversations.
          countAriaLabel={
            unreadSmsCount > 0 ? t`${unreadSmsCount} unread` : undefined
          }
        />
        <NavigationDrawerItem
          label={t`Settings`}
          Icon={IconSettings}
          onClick={handleSettingsClick}
        />
        <NavigationDrawerItem
          label={t`Documentation`}
          to={getDocumentationUrl({
            locale: currentWorkspaceMember?.locale,
          })}
          Icon={IconHelpCircle}
        />
      </AnimatedExpandableContainer>
    </NavigationDrawerSection>
  );
};
