# Fleet additions

Fleet runs the upstream Pi Web frontend through a machine-routing gateway and uses
[standalone API agents](../agent/README.md). Its implementation stays in new files;
upstream API handlers, authentication, sessions and terminal logic are reused.

## Integration points

- `next.config.ts` calls `withFleetConfig`. Only `PI_FLEET_STATIC_EXPORT=1` enables
  static export and the Fleet client. Normal Node/Next development keeps the
  upstream configuration and does not fetch the Fleet machine list.
- `app/page.tsx` imports the Fleet wrapper. AppShell uses one hook to namespace
  terminal-tab storage by machine; SessionSidebar mounts one machine selector.
- `app/layout.tsx` delegates Fleet metadata, first-paint setup, service-worker
  registration and PWA sizing to this directory.
- `lib/theme.ts` adds four theme options. Their CSS stays in `app/fleet-themes.css`;
  Fleet-specific layout overrides are scoped to `html[data-fleet]`.
- FileViewer passes resource links through the existing Fleet URL adapter.

## PWA compatibility

The invisible fixed 11px status strip lets WebKit sample the theme background.
It adds no layout height and uses `background-clip: text` to avoid covering
controls. Fleet uses the default Apple status-bar mode. This preserves the
[iOS 27 workaround](https://zenn.dev/uakihir0/articles/260920-ios27-pwa-blur);
desktop emulation cannot certify native iOS blur behavior.

The Fleet platform component maintains the standalone baseline height while the
upstream viewport hook owns keyboard sizing. The baseline never replaces the
height while `data-keyboard-open` is true. Theme-color follows the selected palette,
and old `default-light`/`default-dark` preferences migrate before hydration.

## Release workflow

Only `.github/workflows/container.yml` (Fleet Release) is enabled in this fork.
It runs validation, builds the frontend image and both API binaries, and attaches
checksummed binaries to a prepared release for a version tag. Manual runs validate
and publish a commit-tagged image without changing the latest release.

Upstream CI, Demo and npm Publish files are retained. Disable their workflows in
the fork's Actions settings, along with the retired separate API binaries workflow.
The upstream repository's workflow files continue to work there.
