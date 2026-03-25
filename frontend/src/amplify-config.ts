import { Amplify } from "aws-amplify";

Amplify.configure({
  API: {
    GraphQL: {
      endpoint:
        "https://zmtlov65uvfytcz2dieomf5zdu.appsync-api.us-east-1.amazonaws.com/graphql",
      region: "us-east-1",
      defaultAuthMode: "apiKey",
      apiKey: "da2-6xq53ita4zh2xlhg7rhedxxxhe",
    },
  },
});
