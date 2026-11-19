# The probe app: the Rust core (../build-core.sh) in an app for iOS 8 on armv7, through Theos (../README.md).
TARGET := iphone:clang:9.3:8.0
ARCHS = armv7
CORE = $(THEOS_PROJECT_DIR)/../.build/target/armv7-apple-ios/release
HEADER = $(THEOS_PROJECT_DIR)/../../../apps/mac/Sources/GPCoreFFI

include $(THEOS)/makefiles/common.mk

APPLICATION_NAME = GPCore8
GPCore8_FILES = main.m AppDelegate.m Core.m clock.c
GPCore8_FRAMEWORKS = UIKit Foundation
# SDK 9.3's module maps are named module.map, which today's clang warns of and Theos makes an error; and [X alloc] as
# a message, not objc_alloc, which iOS 8's runtime may not export.
GPCore8_CFLAGS = -fobjc-arc -Wno-deprecated-module-dot-map -fno-objc-convert-messages-to-runtime-calls -I$(HEADER)
GPCore8_LDFLAGS = -L$(CORE) -lgp_core_ffi

include $(THEOS_MAKE_PATH)/application.mk
