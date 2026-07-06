// Impression fork: the private Feedback Board is a separate Express app mounted
// at an unguessable path on the SAME origin as the CRM, so a relative fetch
// reaches its API with no CORS setup. Keep this token in sync with the nginx
// location and the sidebar entry in NavigationDrawerOtherSection.
export const FEEDBACK_BOARD_BASE_PATH =
  '/board-480d724fe05b0c3f74bc75dff25f9301';

export const FEEDBACK_BOARD_CARDS_ENDPOINT = `${FEEDBACK_BOARD_BASE_PATH}/api/cards`;

export const FEEDBACK_REQUEST_MODAL_ID = 'feedback-request-modal';
