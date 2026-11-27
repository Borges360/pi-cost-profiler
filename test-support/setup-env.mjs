// Tests and smokes never install themes into the real ~/.pi (see registerInteiroPiThemes).
process.env.PI_DESIGN_THEMES ??= 'off';
