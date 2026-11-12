{ pkgs, inputs, config, lib, ... }:

{
  packages = [
    pkgs.nodejs_24
    pkgs.dotnet-sdk_10
    pkgs.rustc
    pkgs.cargo
    pkgs.clippy
    pkgs.gcc
    pkgs.gnumake
    pkgs.pkg-config
    pkgs.openssl
    pkgs.openssl.dev
    pkgs.cacert
    pkgs.gtk3
    pkgs.gtk3.dev
    pkgs.webkitgtk_4_1
    pkgs.webkitgtk_4_1.dev
    pkgs.glib-networking
    pkgs.gsettings-desktop-schemas
    pkgs.dbus
    pkgs.xvfb-run
  ];

  env = {
    DOTNET_CLI_TELEMETRY_OPTOUT = "1";
    DOTNET_NOLOGO = "1";
    # The caller's LD_LIBRARY_PATH names libraries built against a newer glibc than this shell's compiler. GNU ld searches it for the
    # dependencies of every shared library it links, so a trivial program linked against WebKitGTK failed on GLIBC_2.43 symbols.
    # Prebuilt npm binaries still need a libstdc++ and zlib, which this shell takes from the same pinned nixpkgs as its compiler.
    LD_LIBRARY_PATH = lib.makeLibraryPath [ pkgs.stdenv.cc.cc.lib pkgs.zlib ];
    GIO_EXTRA_MODULES = "${pkgs.glib-networking}/lib/gio/modules";
    XDG_DATA_DIRS = "${pkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${pkgs.gsettings-desktop-schemas.name}:${pkgs.gtk3}/share/gsettings-schemas/${pkgs.gtk3.name}";
    CONTRACT_GENERATOR_TYPEMODELING_SOURCE = "${inputs.typemodeling-dotnet}";
    CONTRACT_GENERATOR_EFFECTSYSTEM_SOURCE = "${inputs.effectsystem-dotnet}";
    TypeModelingProjectPath = "${config.devenv.root}/work/native-dependencies/typemodeling-dotnet/src/TypeModeling/TypeModeling.csproj";
    EffectSystemProjectPath = "${config.devenv.root}/work/native-dependencies/effectsystem-dotnet/src/EffectSystem/EffectSystem.csproj";
  };

  # The environment's verification gate calls `devenv shell -- verify`; the npm script stays the single definition of the checks.
  scripts.verify.exec = ''
    set -euo pipefail

    npm run verify
  '';

}
