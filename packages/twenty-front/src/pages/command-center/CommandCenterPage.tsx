// Impression fork: the Daily Command Center is a separate Express app (nginx
// serves it at /command-center/, and the CRM SPA cannot own that path), so it
// is embedded here as a same-origin frame — but chromeless. The page is the
// app's own top bar (title + status strip) with the tool filling everything
// below it edge to edge; the tool loads with ?embed=1 and drops its own brand
// row and its own request light in return (see its index.html). One app, no
// frame in a frame, one feedback entry.
import { styled } from '@linaria/react';
import { IconListCheck } from 'twenty-ui/display';

import { PageContainer } from '@/ui/layout/page/components/PageContainer';
import { PageHeader } from '@/ui/layout/page/components/PageHeader';
import { PageTitle } from '@/ui/utilities/page-title/components/PageTitle';

// The embedded app owns its own scrolling, so the frame fills the whole
// content area (no page-body padding, no panel around it — the dark tool IS
// the page) and never produces a second, nested scrollbar.
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
    {/* Plain string (not the t`` macro): "Command Center" isn't in the
        compiled Lingui catalog, so the macro renders the message id
        ("Nf5ZtG") as the browser TAB TITLE — which is exactly what Moshe
        flagged on the board ("with the word tab name NF5ZG, I have no clue
        what this means"). Same treatment as the nav drawer item. */}
    {/* eslint-disable-next-line lingui/no-unlocalized-strings */}
    <PageTitle title="Command Center" />
    {/* eslint-disable-next-line lingui/no-unlocalized-strings */}
    <PageHeader title="Command Center" Icon={IconListCheck} />
    <StyledFrameWrapper>
      <StyledFrame
        src="/command-center/?embed=1"
        title="Command Center"
        // Same-origin app of our own: allow-same-origin keeps its session
        // cookie working, and it needs scripts + forms to function at all.
        // allow-top-navigation-by-user-activation lets lead-name links open
        // the person's CRM profile in the top window (a click, not a script).
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-downloads allow-top-navigation-by-user-activation"
      />
    </StyledFrameWrapper>
  </PageContainer>
);
