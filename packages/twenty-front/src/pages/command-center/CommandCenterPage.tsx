// Impression fork: the Daily Command Center used to be an external link, which
// dumped you into a bare page with no sidebar and no header — you had left the
// app. It is a separate Express app (nginx serves it at /command-center/, and
// the CRM SPA cannot own that path), so it is embedded here instead: same
// origin, so its CRM single sign-on and cookies work untouched, but it now
// lives inside the normal shell with the nav, the header and the feedback icon.
import { styled } from '@linaria/react';
import { t } from '@lingui/core/macro';
import { IconListCheck } from 'twenty-ui/display';

import { MainContainerLayoutWithSidePanel } from '@/object-record/components/MainContainerLayoutWithSidePanel';
import { PageContainer } from '@/ui/layout/page/components/PageContainer';
import { PageHeader } from '@/ui/layout/page/components/PageHeader';
import { PageTitle } from '@/ui/utilities/page-title/components/PageTitle';

// The embedded app owns its own scrolling, so the frame fills the area and
// never produces a second, nested scrollbar.
const StyledFrame = styled.iframe`
  border: none;
  display: block;
  height: 100%;
  width: 100%;
`;

const StyledFrameWrapper = styled.div`
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
`;

export const CommandCenterPage = () => (
  <PageContainer>
    <PageTitle title={t`Command Center`} />
    <PageHeader title={t`Command Center`} Icon={IconListCheck} />
    <MainContainerLayoutWithSidePanel>
      <StyledFrameWrapper>
        <StyledFrame
          src="/command-center/"
          title={t`Command Center`}
          // Same-origin app of our own: allow-same-origin keeps its session
          // cookie working, and it needs scripts + forms to function at all.
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-downloads"
        />
      </StyledFrameWrapper>
    </MainContainerLayoutWithSidePanel>
  </PageContainer>
);
