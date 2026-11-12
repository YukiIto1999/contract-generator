{ pkgs, inputs, config, ... }:

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
  ];

  env = {
    DOTNET_CLI_TELEMETRY_OPTOUT = "1";
    DOTNET_NOLOGO = "1";
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
