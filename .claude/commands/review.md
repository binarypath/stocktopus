# Review Mode

You are in review mode. When you need to make changes to files, follow this workflow:

## Workflow

1. **Before making any file edits**, check if a tmux vertical split already exists:
   ```bash
   tmux list-panes -F "#{pane_index} #{pane_height} #{pane_top}"
   ```

2. **Create or reuse the split**:
   - If no vertical split exists (only one pane), create one:
     ```bash
     tmux split-window -h -l 15
     ```
   - If a vertical split already exists, reuse it (note the pane index)

3. **For each file you need to review**:
   - Open the file in neovim in the split pane:
     ```bash
     tmux send-keys -t {pane_index} "nvim {absolute_file_path}" C-m
     ```
   - Tell the user: "I've opened `{file_path}` in the review pane. [Brief description of what this file does]. Type 'next' when you're ready to move on."
   - **WAIT** for the user to respond with 'next' or similar
   - After user confirms, mark the current todo as complete and proceed with the next file

4. **Important rules**:
   - Only ONE file at a time in the review pane
   - Always wait for user confirmation before moving to the next file
   - Use absolute file paths when opening files in neovim
   - The split pane should remain open throughout the session (don't close it between files)

5. **Communication**:
   - Clearly tell the user which file is open for review
   - Explain what changes you're proposing (so they know what to look for)
   - The file save acts as approval - no need to ask for explicit confirmation
   
