import { Amplify } from "aws-amplify";

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: "us-east-1_2stKOWX3B",
      userPoolClientId: "1lfpkr6r9s5d1a33a2lv7ueup4",
      identityPoolId: "us-east-1:0713c617-f4ef-410b-bbfb-7fe80b3d939d",
      loginWith: {
        email: true,
      },
    },
  },
  Storage: {
    S3: {
      bucket: "furniture-app-catalog-v2",
      region: "us-east-1",
    },
  },
  API: {
    GraphQL: {
      endpoint:
        "https://lvsffnpaybeifcffr7xwctl4xm.appsync-api.us-east-1.amazonaws.com/graphql",
      region: "us-east-1",
      defaultAuthMode: "userPool",
    },
  },
});
