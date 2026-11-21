# Current MongoDB implementation ownership

The active native-database work is governed by [the parent contract](../../NATIVE-DATABASE-CONTRACT.md) and [the native repository catalog](base-repository.md). This app contains MongoDB/Mongoose only; PostgreSQL is a separately owned sibling. The old combined memory/MongoDB/PostgreSQL assignment is superseded.

The Mongo worker owns this app except package-lock.json, node_modules, dist, var and the three database-isolation checker/test files. Coordinator owns lock/install/build, infrastructure, runtime/browser acceptance and parent documentation. VCLI remains unimplemented. Provider fakes stay under test helpers; database tests use TEST_DATABASE_URL and skip explicitly when local setup is absent.
