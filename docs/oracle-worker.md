# Run the media worker on Oracle Cloud (Always Free)

1. Create an Oracle Cloud account (cloud.oracle.com). A card is used only to verify you.
2. Compute, Instances, Create instance.
   - Image: Ubuntu 24.04 (the ARM / aarch64 build).
   - Shape: Ampere, VM.Standard.A1.Flex, 2 OCPU and 12 GB memory. This is inside the free allowance.
   - Networking: keep the defaults and make sure a public IP is assigned.
   - SSH keys: choose "Generate a key pair for me" and save it. You will not need it for setup.
3. Open Advanced options, Management, "Cloud-init script", and paste the contents of `oracle-cloud-init.sh` with the blanks filled in.
4. Create. Setup runs by itself on first boot and takes about 10 minutes.
5. The worker tells the web app its address within a minute of starting. Nothing to copy into Vercel.

Update later: `sudo bash /opt/video-studio/deploy/oracle/update.sh`
Logs: `/var/log/video-studio-setup.log`, `journalctl -u video-studio-worker`, `journalctl -u video-studio-tunnel`
