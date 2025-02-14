{
  inputs = {
    nixpkgs.url = "nixpkgs";
    rust-overlay.url = "github:oxalica/rust-overlay";
  };

  outputs = { self, nixpkgs, rust-overlay }:
    let
      overlays = [ rust-overlay.overlays.default ];

      pkgs = import nixpkgs {
        system = "aarch64-darwin";
        inherit overlays;
      };
      pkgsX86 = import nixpkgs {
        system = "x86_64-darwin";
        inherit overlays;
      };

      rustToolchainExtensions = [ "rust-src" "rust-analyzer" "clippy" ];
      rustToolchain = pkgs.rust-bin.stable.latest.default.override {
        targets = [ "aarch64-apple-darwin" ];
        extensions = rustToolchainExtensions;
      };
      rustToolchainX86 = pkgsX86.rust-bin.stable.latest.default.override {
        targets = [ "x86_64-apple-darwin" ];
        extensions = rustToolchainExtensions;
      };

      buildInputs = p: with p; [ apple-sdk_12 ];

      commonPackages = p: with p; [ cargo-tauri nodejs_22 corepack_22 bacon ];

    in {
      devShells = {
        aarch64-darwin.default = pkgs.mkShellNoCC {
          buildInputs = buildInputs pkgs;
          packages = [ rustToolchain ] ++ (commonPackages pkgs);
          shellHook = ''
            echo "=== 🛠️ DEV SHELL (APPLE SILICON) ==="
          '';
        };
        x86_64-darwin.default = pkgsX86.mkShellNoCC {
          buildInputs = buildInputs pkgsX86;
          packages = [ rustToolchainX86 ] ++ (commonPackages pkgsX86);
          shellHook = ''
            echo "=== 🛠️ DEV SHELL (APPLE ROSETTA) ==="
          '';
        };
      };
    };
}
