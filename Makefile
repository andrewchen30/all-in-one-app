.PHONY: help dev build typecheck test-signaling ios-gen ios-devices ios-install ios-cert clean-web

# The UDID of the iPhone acting as the camera. Find it with `make ios-devices`,
# then either pass DEVICE_ID=... or put it in a local .make.env.
-include .make.env
DEVICE_ID ?=

XCODEPROJ := apps/ios/AllInOne.xcodeproj
SCHEME    := AllInOne
DERIVED   := apps/ios/DerivedData

help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

# --- web -------------------------------------------------------------------

dev: ## Run the web app + signaling server on :3000
	pnpm dev

build: ## Production build of the web app
	pnpm build

typecheck: ## Typecheck every workspace package
	pnpm typecheck

test-signaling: ## End-to-end test of the signaling layer (needs `make dev` running)
	node scripts/test-signaling.mjs

# --- ios -------------------------------------------------------------------

ios-gen: ## Regenerate the Xcode project from project.yml
	@test -f apps/ios/Secrets.xcconfig \
		|| cp apps/ios/Secrets.example.xcconfig apps/ios/Secrets.xcconfig
	xcodegen generate --spec apps/ios/project.yml --project apps/ios

ios-devices: ## List connected/paired iOS devices and their UDIDs
	xcrun devicectl list devices

# The weekly ritual under free provisioning: a signing certificate lasts 7 days,
# after which the app refuses to launch. Enable "Connect via network" for the
# iPhone once in Xcode → Window → Devices and Simulators, and this reinstalls
# over Wi-Fi with the phone left where it is.
ios-install: ios-gen ## Build and (re)install onto DEVICE_ID — run weekly to re-sign
	@test -n "$(DEVICE_ID)" \
		|| (echo "DEVICE_ID is not set. Run 'make ios-devices' and set it in .make.env" && exit 1)
	xcodebuild \
		-project $(XCODEPROJ) \
		-scheme $(SCHEME) \
		-configuration Debug \
		-destination 'platform=iOS,id=$(DEVICE_ID)' \
		-derivedDataPath $(DERIVED) \
		-allowProvisioningUpdates \
		build
	xcrun devicectl device install app \
		--device $(DEVICE_ID) \
		$(DERIVED)/Build/Products/Debug-iphoneos/All-in-One.app

ios-cert: ## Show when the installed build's signing certificate expires
	@/usr/libexec/PlistBuddy -c 'Print :ExpirationDate' /dev/stdin <<< "$$(security cms -D -i $(DERIVED)/Build/Products/Debug-iphoneos/All-in-One.app/embedded.mobileprovision 2>/dev/null)" 2>/dev/null \
		|| echo "No built app found — run 'make ios-install' first."
