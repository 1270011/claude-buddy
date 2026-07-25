Output scripts/ci/statusline.gif
Set Width 1400
Set Height 500
Set FontSize 14
Set Shell "bash"
Type "echo '{\"session_id\":\"ci\",\"model\":{\"display_name\":\"CI\"},\"workspace\":{\"current_dir\":\".\"}}' | CLAUDE_CONFIG_DIR=scripts/ci/statusline-fixture bash statusline/buddy-status.sh"
Enter
Sleep 12s
Screenshot scripts/ci/statusline.png
