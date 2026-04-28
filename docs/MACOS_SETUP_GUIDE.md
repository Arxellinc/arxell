# macOS Build Setup Guide

This guide walks through setting up the Arxell build environment on macOS for building the Tauri desktop application.

## Prerequisites

- macOS 11 (Big Sur) or later
- Administrator access on the Mac
- Internet connection
- Xcode Command Line Tools

## Step 1: Enable SSH on macOS

To enable remote access via SSH:

```bash
# Enable SSH server
sudo systemsetup -setremotelogin on

# Verify SSH is enabled
sudo systemsetup -getremotelogin
```

To find your Mac's IP address:

```bash
# Get your local IP address
ipconfig getifaddr en0
# or for Wi-Fi
ipconfig getifaddr en1
```

## Step 2: Install Xcode Command Line Tools

These are required for building native macOS applications:

```bash
# Install Xcode Command Line Tools
xcode-select --install
```

A dialog will appear - click "Install" and wait for the installation to complete.

Verify installation:

```bash
xcode-select -p
```

## Step 3: Install Homebrew

Homebrew is the package manager for macOS:

```bash
# Install Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Follow the post-installation instructions to add Homebrew to your PATH.

## Step 4: Install Rust Toolchain

Install Rust using rustup:

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Source the environment
source $HOME/.cargo/env

# Verify installation
rustc --version
cargo --version
```

## Step 5: Install Node.js and npm

Install Node.js using Homebrew:

```bash
# Install Node.js LTS
brew install node

# Verify installation
node --version
npm --version
```

## Step 6: Clone the Repository

```bash
# Navigate to your development directory
cd ~/Projects

# Clone the repository (replace with your actual repo URL)
git clone <repository-url> arxell
cd arxell

# Initialize and update submodules
git submodule update --init --recursive
```

## Step 7: Install Frontend Dependencies

```bash
# Navigate to frontend directory
cd frontend

# Install dependencies
npm install

# Return to project root
cd ..
```

## Step 8: Install Tauri CLI

```bash
# Install Tauri CLI globally
npm install -g @tauri-apps/cli

# Verify installation
cargo tauri --version
```

## Step 9: Install Additional Dependencies

Some Rust dependencies may require additional libraries:

```bash
# Install OpenSSL (if needed)
brew install openssl

# Install pkg-config (if needed)
brew install pkg-config
```

## Step 10: Development Build

To run the development build:

```bash
# Start the development server
cargo tauri dev
```

This will:
1. Start the Vite dev server for the frontend
2. Build and run the Tauri application

## Step 11: Production Build

To create a distributable macOS application:

```bash
# Build the release version
cargo tauri build
```

The built application will be located at:
```
src-tauri/target/release/bundle/dmg/Arxell_<version>_aarch64.dmg
```

or for Intel Macs:
```
src-tauri/target/release/bundle/dmg/Arxell_<version>_x64.dmg
```

## Troubleshooting

### Permission Denied Errors

If you encounter permission errors when running commands:

```bash
# Fix permissions on Cargo directory
sudo chown -R $USER:$(id -gn $USER) ~/.cargo
```

### OpenSSL Linking Issues

If you encounter OpenSSL linking errors:

```bash
# Set OpenSSL environment variables
export OPENSSL_DIR=$(brew --prefix openssl)
export OPENSSL_LIB_DIR=$OPENSSL_DIR/lib
export OPENSSL_INCLUDE_DIR=$OPENSSL_DIR/include
```

### Code Signing Issues

For development builds, you may need to disable code signing:

Edit `src-tauri/tauri.conf.json` and ensure:

```json
{
  "bundle": {
    "macOS": {
      "signingIdentity": null,
      "provisioningProfile": null,
      "entitlements": null,
      "hardenedRuntime": false
    }
  }
}
```

### Architecture-Specific Builds

To build for a specific architecture:

```bash
# For Apple Silicon (M1/M2/M3)
cargo tauri build --target aarch64-apple-darwin

# For Intel Macs
cargo tauri build --target x86_64-apple-darwin

# Universal binary (requires both architectures)
cargo tauri build --target universal-apple-darwin
```

## VS Code Remote SSH Setup

1. Install the "Remote - SSH" extension in VS Code
2. Configure SSH hosts in `~/.ssh/config`:

```
Host macbook
    HostName <your-mac-ip-address>
    User <your-username>
    IdentityFile ~/.ssh/id_rsa
```

3. Connect to the Mac using the Remote SSH extension
4. Open the project folder and start developing

## Useful Commands

```bash
# Check Rust toolchain
rustup show

# Update Rust
rustup update

# Check Node.js version
node --version

# Update npm packages
cd frontend && npm update

# Clean build artifacts
cargo clean

# Check Tauri configuration
cargo tauri info
```

## Next Steps

Once the environment is set up:

1. Run `cargo tauri dev` to test the development build
2. Check the [ARCHITECTURE.md](ARCHITECTURE.md) for project structure
3. Review [TAURI_INTEGRATION.md](TAURI_INTEGRATION.md) for Tauri-specific details
4. Run the smoke tests following [SMOKE_TEST.md](SMOKE_TEST.md)

## Additional Resources

- [Tauri v2 Documentation](https://v2.tauri.app/start/)
- [Rust on macOS Guide](https://doc.rust-lang.org/book/ch01-01-installation.html)
- [Node.js on macOS](https://nodejs.org/)
