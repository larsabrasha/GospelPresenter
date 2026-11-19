# The probe app: the Rust core and SQLite (../build-core.sh) in an app for iOS 8 on armv7, through Theos
# (../README.md).
TARGET := iphone:clang:9.3:8.0
ARCHS = armv7
CORE = $(THEOS_PROJECT_DIR)/../.build/target/armv7-apple-ios/release
SQLITE = $(THEOS_PROJECT_DIR)/../.build/sqlite
HEADER = $(THEOS_PROJECT_DIR)/../../../apps/mac/Sources/GPCoreFFI

include $(THEOS)/makefiles/common.mk

APPLICATION_NAME = GPCore8
GPCore8_FILES = main.m AppDelegate.m Core.m Sync.m WebSocket.m Texts.m Presentations.m Details.m PresentationController.m Live.m LivePanel.m OneColumn.m ItemMenu.m PresentationMenu.m AddSong.m SlideView.m ScrollTest.m clock.c
GPCore8_FRAMEWORKS = UIKit Foundation CoreGraphics CoreText QuartzCore Security
# SDK 9.3's module maps are named module.map, which today's clang warns of and Theos makes an error; and [X alloc] as
# a message, not objc_alloc, which iOS 8's runtime may not export.
GPCore8_CFLAGS = -fobjc-arc -Wno-deprecated-module-dot-map -fno-objc-convert-messages-to-runtime-calls -I$(HEADER) -I$(SQLITE) -marm
GPCore8_LDFLAGS = -L$(CORE) -lgp_core_ffi -L$(SQLITE) -lsqlite3
# All of it in ARM, not Thumb (-marm, at the end of the CFLAGS above): today's ld leaves out the Thumb bit ld64 set on
# a pointer to a Thumb function, in LC_MAIN's entryoff and in the Objective-C method lists, so dyld and UIKit jump to
# Thumb code in ARM mode (on the iPad, 2026-11-19: SIGILL in main, then SIGSYS in didFinishLaunching). The core's Rust
# is ARM already, and build-core.sh builds SQLite as ARM.

include $(THEOS_MAKE_PATH)/application.mk
