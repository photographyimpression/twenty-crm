export const getMicrosoftApisOauthScopes = () => {
  const scopes = [
    'openid',
    'email',
    'profile',
    'offline_access',
    'Mail.ReadWrite',
    'Mail.Send',
    'Calendars.ReadWrite',
    'OnlineMeetings.ReadWrite',
    'User.Read',
  ];

  return scopes;
};
