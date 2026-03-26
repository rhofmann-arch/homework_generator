# Problem Bank

## honors/
Challenge problem snippets exported from Overleaf.

**Naming convention:** `ch{N}_{short_description}.tex`  
Examples: `ch1_exponents_challenge.tex`, `ch3_fractions_challenge.tex`

Each file should have `% BEGIN CHALLENGE PROBLEMS` and `% END CHALLENGE PROBLEMS` 
markers so the backend can extract just the problem content.

**To add new problems:**
1. Write or edit them in Overleaf
2. Export the `.tex` file (or copy the relevant snippet)
3. Add the markers and drop the file in this folder
4. Commit and push — the backend picks them up automatically

## spiral_review/
Style reference snippets organized by topic.  
These are used to calibrate problem difficulty and format when prompting Claude.

**Naming convention:** `{topic_slug}.tex`  
Examples: `powers_exponents.tex`, `fractions_add_subtract.tex`
