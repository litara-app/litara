# Audit L6 regression: failing run against the imported baseline

Command (apps/android): ./gradlew :app:testFullDebugUnitTest --tests com.litara.core.auth.AccountScopeTest
Run before any production-code change, against commit 2ed44c8 + only the new test file.

```
Calculating task graph as no cached configuration is available for tasks: :app:testFullDebugUnitTest --tests com.litara.core.auth.AccountScopeTest
AccountScopeTest > two accounts on one server never share a data scope FAILED
    java.lang.AssertionError at AccountScopeTest.kt:50
AccountScopeTest > switching account on the same server requires reopening the data set FAILED
    java.lang.AssertionError at AccountScopeTest.kt:59
AccountScopeTest > an account and server pair maps to a stable distinct scope FAILED
    java.lang.AssertionError at AccountScopeTest.kt:81
AccountScopeTest > the first account to sign in after upgrade claims the pre-existing unscoped data FAILED
    java.lang.AssertionError at AccountScopeTest.kt:92
5 tests completed, 4 failed
BUILD FAILED in 2m 4s
```
