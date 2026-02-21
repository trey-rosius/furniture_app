import { Amplify } from 'aws-amplify';

Amplify.configure({
  API: {
    GraphQL: {
      endpoint: 'https://lvsffnpaybeifcffr7xwctl4xm.appsync-api.us-east-1.amazonaws.com/graphql',
      region: 'us-east-1',
      defaultAuthMode: 'apiKey',
      apiKey: 'da2-nkn7jpnymvfgpadtrw54j3bg2e'
    }
  }
});
