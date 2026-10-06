bedrock is a personal cloud for small to medium projects to be hosted and shared on the cloud; bedrock is a heavily opinionated service not meant to be used to build things by many people, it is built with the assumption that less than 10 people will create with it. This doesn't mean bedrock isn't efficient, lightweight, modular and extensible.

projects that use bedrock are called pebbles.

everything should be doable from code, bedrock should be a npm package with a very agent friendly api:
  - database: db creation, migration, management should be easily be done in code
  - storage
  - sync engine: assure data is synced live to all users using a pebble, ofc if this is enabled
  - auth: auth if enabled should be easy, use google sign in
  - theming: use onyx from playground/babel-ui